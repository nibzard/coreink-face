#!/usr/bin/env python3
"""Benchmark public Worker -> API/Jev -> physical CoreInk refresh, without forcing polls.

USB supplies power: battery voltage is diagnostic, NOT energy consumption.
Run with the IDF Python environment (pyserial) and the normal sleeping firmware.
"""
import argparse,json,queue,re,threading,time,statistics,uuid
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError
import serial

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--port',required=True)
p.add_argument('--site',default='https://pebble-little-moments.niko370669.chatgpt.site')
p.add_argument('--secrets-file',default=str(Path(__file__).resolve().parents[2]/'.deployment-secrets.json'))
p.add_argument('--origin',default='https://coreink-face-api.nikola-balic.workers.dev')
p.add_argument('--samples',type=int,default=3)
p.add_argument('--label',default='baseline')
p.add_argument('--report',required=True)
a=p.parse_args()
if a.samples<1: p.error('--samples must be positive')
q=queue.Queue();events=[];stop=threading.Event()
ser=serial.Serial(port=None,baudrate=115200,timeout=.2)
ser.dtr=False
ser.rts=False
ser.port=a.port
ser.open()
def reader():
 while not stop.is_set():
  line=ser.readline().decode('utf-8',errors='replace').strip()
  if line.startswith('INK '):
   e={'time':time.monotonic(),'line':line};events.append(e);q.put(e);print(line,flush=True)
thread=threading.Thread(target=reader,daemon=True);thread.start()
def until(predicate,timeout=150):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  try:e=q.get(timeout=min(1,max(.01,end-time.monotonic())))
  except queue.Empty:continue
  if predicate(e):return e
 raise TimeoutError('Device event not observed; device disconnected, asleep too long, or another sender replaced the revision')
def http(path,body=None):
 req=Request(a.site.rstrip('/')+path,data=json.dumps(body).encode() if body else None,headers={'Content-Type':'application/json','User-Agent':'PebbleBenchmark/1.0'})
 with urlopen(req,timeout=25) as r:return json.load(r)
def fields(e):return {k:int(v) for k,v in re.findall(r'(\w+)=(-?\d+)',e['line'])}
secrets=json.loads(Path(a.secrets_file).read_text())
run_id=uuid.uuid4().hex[:6]
report={'label':a.label,'site':a.site,'date':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'samples':[],'method':{'polling':'normal timer sleep; no forced USB poll','send_phase':'immediately after observed sleep event','render_completion':'panel busy signal via firmware serial metric; not optical capture','power':'USB connected and charging','cpu_mhz':160},'energy':{'measured':False,'reason':'USB powered; CoreInk battery ADC measures voltage, not current or charge. No current logger connected.'}}
def save():
 Path(a.report).parent.mkdir(parents=True,exist_ok=True);Path(a.report).write_text(json.dumps(report,indent=2)+'\n')
try:
 # Wait for an ordinary poll/sleep cycle first; the serial port may reset on open.
 until(lambda e:'INK METRIC awake_ms=' in e['line'])
 for i in range(a.samples):
  # Distinct content guarantees a framebuffer change. No explicit face, no USB forced poll.
  message=f'Benchmark {a.label} {i+1} {run_id}'
  start=time.monotonic()
  try:frame=http('/api/moments',{'message':message})
  except HTTPError as error:
   raise RuntimeError(f'Inbox submission failed with HTTP {error.code}; no completion was recorded') from None
  accepted=time.monotonic();queue_id=frame['id'];revision=None
  deadline=time.monotonic()+300
  while time.monotonic()<deadline:
   req=Request(a.origin.rstrip('/')+'/v1/devices/pebble/display',headers={'Authorization':'Bearer '+secrets['API_TOKEN'],'User-Agent':'PebbleBenchmark/1.0'})
   with urlopen(req,timeout=15) as r:current=json.load(r)
   if current.get('message')==message:
    revision=current['revision'];frame=current;break
   time.sleep(1)
  if revision is None:raise TimeoutError('Queued message has not reached the display; resume live mode or let earlier messages drain')
  poll=until(lambda e:'INK METRIC poll_ms=' in e['line'] and fields(e).get('revision')==revision and e['time']>=start)
  rendered=until(lambda e:'INK METRIC render_ms=' in e['line'] and fields(e).get('revision')==revision)
  sleep=until(lambda e:'INK METRIC awake_ms=' in e['line'])
  f=fields(sleep);render=fields(rendered)
  sample={'queue_id':queue_id,'revision':revision,'face':frame['face'],'selection':frame.get('selection',{}),'submit_to_accept_ms':round((accepted-start)*1000),'accept_to_device_poll_ms':round((poll['time']-accepted)*1000),'submit_to_refresh_complete_ms':round((rendered['time']-start)*1000),'poll_ms':fields(poll)['poll_ms'],'render_ms':render['render_ms'],'awake_ms':f['awake_ms'],'sleep_s':f['sleep_s'],'battery_mv':f['battery_mv'],'post_render_to_sleep_ms':round((sleep['time']-rendered['time'])*1000)}
  report['samples'].append(sample);save();print('SAMPLE '+json.dumps(sample),flush=True)
 report['summary']={k:{'min':min(s[k] for s in report['samples']),'median':statistics.median(s[k] for s in report['samples']),'max':max(s[k] for s in report['samples'])} for k in ['submit_to_accept_ms','submit_to_refresh_complete_ms','poll_ms','render_ms','awake_ms','post_render_to_sleep_ms']}
 # Include unchanged 304 wakes to see the common idle cost as well.
 report['idle_cycles']=[fields(e) for j,e in enumerate(events) if 'INK METRIC awake_ms=' in e['line'] and any('INK POLL status=304' in x['line'] for x in events[max(0,j-4):j])]
 report['complete']=True;save();print('RESULT '+json.dumps(report['summary']),flush=True)
finally:
 stop.set();thread.join(timeout=1);ser.close();save()
