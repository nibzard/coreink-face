#include "coreink.hpp"
#include "render.hpp"
#include "history.hpp"
#include "display_update.hpp"
#include "network.hpp"
#include "storage.hpp"
#include "display.hpp"
#include <M5Unified.h>
#include "driver/gpio.h"
#include "driver/rtc_io.h"
#include "driver/uart.h"
#include "esp_random.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <algorithm>
#include <cstdio>
#include <cstring>

namespace {
ink::Config config;
ink::State state;
ink::History history;
bool browsing=false, view_dirty=false;
bool full_message=false, shown_full_message=false, request_click=false;
int browse_delta=0;
int64_t cycle_start_ms=0;
int64_t last_interaction_ms=-10000;
bool needs_cleanup=false;
int64_t led_until_ms=0;
ink::Framebuffer pending_frame{}, shown_frame{};
device::CoreInkDisplay display;
bool configured = false;
bool request_poll = false;
bool request_status = false;
bool local_screen = false;
bool fault_wifi = false;
bool fault_api = false;
int64_t fault_expires_ms = 0;
int last_status = 0;
int64_t last_refresh_ms = 0;
int64_t refresh_retry_ms = 0;
constexpr gpio_num_t kButton = GPIO_NUM_38; // CoreInk dial middle; RTC wake capable
constexpr gpio_num_t kWheelUp=GPIO_NUM_37;
constexpr gpio_num_t kWheelDown=GPIO_NUM_39;
constexpr gpio_num_t kPowerHold = GPIO_NUM_12;
constexpr gpio_num_t kStatusLed = GPIO_NUM_10; // active-low CoreInk indicator
int64_t now_ms() { return esp_timer_get_time() / 1000; }
void wipe(void* ptr, size_t length) { auto p = static_cast<volatile unsigned char*>(ptr); while (length--) { *p = 0; ++p; } }

void serial_reply(const char* text) {
    uart_write_bytes(UART_NUM_0, text, std::strlen(text));
    uart_write_bytes(UART_NUM_0, "\n", 1);
}
void reboot() {
    uart_wait_tx_done(UART_NUM_0, pdMS_TO_TICKS(500));
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_restart();
}
void command(char* line) {
    if (!std::strcmp(line, "ping")) serial_reply("INK READY 1");
    else if (!std::strcmp(line, "status")) {
        char output[220];
        std::snprintf(output, sizeof(output), "INK STATUS configured=%d device=%s http=%d battery=%d heap=%lu",
            configured, configured ? config.device_id : "unset", last_status,
            static_cast<int>(M5.Power.getBatteryLevel()), static_cast<unsigned long>(esp_get_free_heap_size()));
        serial_reply(output);
    } else if (!std::strncmp(line, "configure ", 10)) {
        ink::Config next{};
        if (!ink::parse_config(line + 10, std::strlen(line + 10), next)) serial_reply("INK ERROR invalid_config");
        else if (!device::save_config(next)) serial_reply("INK ERROR storage");
        else {
            serial_reply("INK OK configured");
            wipe(&next, sizeof(next)); wipe(line, std::strlen(line)); reboot();
        }
        wipe(&next, sizeof(next));
    } else if (!std::strcmp(line, "reset-config ERASE")) {
        device::clear_config(); serial_reply("INK OK erased"); reboot();
    } else if (!std::strcmp(line, "poll")) {
        request_poll = true; serial_reply("INK OK poll");
    } else if (!std::strcmp(line, "redraw")) {
        state.has_shown = false;
        request_poll = true;
        serial_reply("INK OK redraw");
    } else if (!std::strcmp(line, "awake on") || !std::strcmp(line, "awake off")) {
        if (!configured) { serial_reply("INK ERROR not_configured"); return; }
        auto next = config;
        next.stay_awake = !std::strcmp(line, "awake on");
        if (!device::save_config(next)) serial_reply("INK ERROR storage");
        else { config.stay_awake = next.stay_awake; serial_reply("INK OK awake"); }
        wipe(&next, sizeof(next));
    } else if (!std::strcmp(line, "fault wifi") || !std::strcmp(line, "fault api") || !std::strcmp(line, "fault off")) {
        // USB-only acceptance diagnostics. Never persisted; automatically expire
        // after five minutes or on reset, so a failed test cannot strand a device.
        fault_wifi = !std::strcmp(line, "fault wifi");
        fault_api = !std::strcmp(line, "fault api");
        fault_expires_ms = fault_wifi || fault_api ? now_ms() + 300000 : 0;
        request_poll = true;
        serial_reply(fault_wifi ? "INK FAULT wifi" : fault_api ? "INK FAULT api" : "INK FAULT off");
    } else if (!std::strcmp(line,"history up") || !std::strcmp(line,"history down")) {
        browse_delta += !std::strcmp(line,"history up") ? -1 : 1;
        serial_reply("INK OK history");
    } else if (!std::strcmp(line,"history live")) {
        browsing=false;full_message=false;view_dirty=state.has_latest;local_screen=false;
        if(history.count) history.selected=history.count-1;
        last_interaction_ms=now_ms();request_poll=true;serial_reply("INK OK history");
    } else if (!std::strcmp(line,"view toggle")) {
        request_click=true;serial_reply("INK OK view");
    } else if (!std::strcmp(line, "reboot")) {
        serial_reply("INK OK reboot"); reboot();
    } else serial_reply("INK ERROR unknown_command");
}
void service() {
    // UART is deliberately raw: no terminal/REPL echo of credentials.
    static char line[2048];
    static size_t length = 0;
    static bool overflow = false;
    uint8_t byte;
    while (uart_read_bytes(UART_NUM_0, &byte, 1, 0) == 1) {
        if (byte == '\n') {
            if (overflow) serial_reply("INK ERROR line_too_long");
            else { line[length] = '\0'; command(line); }
            wipe(line, sizeof(line)); length = 0; overflow = false;
        } else if (byte != '\r') {
            if (byte == 0 || length + 1 >= sizeof(line)) overflow = true;
            else if (!overflow) line[length++] = static_cast<char>(byte);
        }
    }
    M5.update();
    static bool was_pressed = false;
    static int64_t pressed_at = 0;
    bool pressed = gpio_get_level(kButton) == 0;
    if (pressed && !was_pressed) pressed_at = now_ms();
    if (!pressed && was_pressed) {
        int64_t duration = now_ms() - pressed_at;
        if (duration >= 1000) request_status = true;
        else if (duration >= 40) request_click=true;
    }
    was_pressed = pressed;
    static bool up=false,down=false;
    static int64_t wheel_at=0;
    bool new_up=gpio_get_level(kWheelUp)==0,new_down=gpio_get_level(kWheelDown)==0;
    if(now_ms()-wheel_at>=80 && ((new_up&&!up)||(new_down&&!down))) {
        browse_delta += new_up ? -1 : 1;wheel_at=now_ms();last_interaction_ms=now_ms();led_until_ms=now_ms()+300;
    }
    up=new_up;down=new_down;
    gpio_set_level(kStatusLed,now_ms()<led_until_ms ? 0 : 1);
}
void wait_until(int64_t deadline) {
    while (now_ms() < deadline) { service(); vTaskDelay(pdMS_TO_TICKS(20)); }
}
bool paint(const ink::Content& content, bool fast=false, bool text_only=false) {
    const auto paint_start = now_ms();
    if(text_only) ink::render_full_message_into(content,pending_frame);
    else ink::render_into(content, pending_frame);
    serial_reply("INK DISPLAY begin");
    if (!display.prepare_refresh(fast)) { serial_reply("INK ERROR display_init"); return false; }
    M5.Display.setEpdMode(fast ? epd_mode_t::epd_fast : epd_mode_t::epd_quality);
    M5.Display.startWrite();
    M5.Display.fillScreen(TFT_WHITE);
    M5.Display.drawBitmap(0, 0, pending_frame.data(), 200, 200, TFT_BLACK);
    M5.Display.endWrite();
    M5.Display.display();
    M5.Display.waitDisplay();
    last_refresh_ms = now_ms(); // includes completion time, conservatively
    needs_cleanup=fast;
    bool ok = !M5.Display.displayBusy();
    if(ok) shown_full_message=text_only;
    serial_reply(ok ? "INK DISPLAY complete" : "INK ERROR display_busy");
    char metric[100];
    std::snprintf(metric, sizeof(metric), "INK METRIC render_ms=%lld revision=%llu", static_cast<long long>(now_ms()-paint_start), static_cast<unsigned long long>(state.latest.revision));
    serial_reply(metric);
    return ok;
}
bool checkpoint() {
    // Cache stores content, not the temporary reading mode. A restart must
    // repaint the regular view even when the server returns the same ETag.
    auto saved=state;
    if(shown_full_message) saved.has_shown=false;
    if (configured && !device::save_cache(config, saved)) { serial_reply("INK ERROR cache_storage"); return false; }
    return true;
}
bool refresh_content(const ink::Content& content, bool fast=false, bool text_only=false) {
    const bool ok = ink::update_display(state, content, checkpoint,
        [=](const ink::Content& target) { return paint(target, fast, text_only); });
    refresh_retry_ms = ok ? 0 : now_ms() + ink::kMinRefreshMs;
    return ok;
}
void record_latest() {
    if (ink::remember_shown(history, state)) {
        if (!device::save_history(config, history)) serial_reply("INK ERROR history_storage");
        checkpoint();
    }
}
void flush_display() {
    if (browsing || full_message || local_screen || !state.has_latest) return;
    if (!ink::pending(state)) { record_latest(); return; }
    if (now_ms() < refresh_retry_ms) return;
    // Compare actual pixels so unsupported glyphs, cropped text, and unknown
    // face IDs do not cause needless physical refreshes.
    ink::render_into(state.latest.content, pending_frame);
    if (state.has_shown) ink::render_into(state.shown, shown_frame);
    if (state.has_shown && shown_frame == pending_frame) {
        ink::displayed(state);
        record_latest();
        return;
    }
    const bool interactive=now_ms()-last_interaction_ms<3000;
    if(!interactive) wait_until(now_ms() + ink::refresh_wait(now_ms(), last_refresh_ms));
    // Record uncertainty before touching hardware: loss of power midway through
    // a refresh must force recovery on the next boot, even after an HTTP 304.
    if (refresh_content(state.latest.content, interactive)) record_latest();
}
void show_local(const char* message) {
    ink::Content content = state.has_latest ? state.latest.content : ink::Content{};
    if (!content.face[0]) std::strcpy(content.face, "small-dots");
    std::snprintf(content.message, sizeof(content.message), "%s", message);
    ink::render_into(content, pending_frame);
    if (state.has_shown) ink::render_into(state.shown, shown_frame);
    if (state.has_shown && shown_frame == pending_frame) { local_screen = true; return; }
    wait_until(now_ms() + ink::refresh_wait(now_ms(), last_refresh_ms));
    if (!refresh_content(content)) return;
    local_screen = true;
}
void show_status() {
    full_message=false;
    char text[180];
    std::snprintf(text, sizeof(text), "%s\nHTTP %d  Battery %d%%\nHold: status; tap: poll",
        configured ? config.device_id : "USB setup required", last_status,
        static_cast<int>(M5.Power.getBatteryLevel()));
    show_local(text);
    request_status = false;
}
void sleep_for(uint32_t seconds) {
    if(needs_cleanup) seconds=std::min<uint32_t>(seconds,std::max<int64_t>(1,(std::max<int64_t>(ink::refresh_wait(now_ms(),last_refresh_ms),refresh_retry_ms-now_ms())+999)/1000));
    if(now_ms()<led_until_ms) wait_until(led_until_ms);
    ESP_ERROR_CHECK(gpio_set_level(kStatusLed,1));
    // GPIO low-level wake lets either direction of the wheel wake the ESP32.
    // Light sleep retains the browsing list in RAM and avoids a custom ULP program.
    if(gpio_get_level(kButton)==0 || gpio_get_level(kWheelUp)==0 || gpio_get_level(kWheelDown)==0) return;
    char metric[100];
    std::snprintf(metric,sizeof(metric),"INK METRIC awake_ms=%lld sleep_s=%lu battery_mv=%ld",static_cast<long long>(now_ms()-cycle_start_ms),static_cast<unsigned long>(seconds),static_cast<long>(M5.Power.getBatteryVoltage()));
    serial_reply(metric);uart_wait_tx_done(UART_NUM_0,pdMS_TO_TICKS(200));
    ESP_ERROR_CHECK(esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(seconds)*1000000));
    ESP_ERROR_CHECK(esp_sleep_enable_gpio_wakeup());
    ESP_ERROR_CHECK(esp_light_sleep_start());
    cycle_start_ms=now_ms();

}
}

extern "C" void app_main() {
    // Configure the new active state before releasing the retained pad, avoiding
    // a low pulse on HOLD as the chip returns from deep sleep.
    ESP_ERROR_CHECK(gpio_set_level(kPowerHold, 1));
    ESP_ERROR_CHECK(gpio_set_direction(kPowerHold, GPIO_MODE_OUTPUT));
    ESP_ERROR_CHECK(gpio_hold_dis(kPowerHold));
    gpio_deep_sleep_hold_dis();
    auto cfg = M5.config();
    cfg.clear_display = false;
    cfg.internal_imu = false;
    cfg.internal_mic = false;
    cfg.internal_spk = false;
    cfg.output_power = false;
    cfg.external_display_value = 0;
    cfg.fallback_board = m5::board_t::board_M5StackCoreInk;
    // Initialize the panel without a physical refresh, then hand the already
    // initialized driver to M5Unified. Its known board makes begin() reuse it.
    ESP_ERROR_CHECK(display.prepare() ? ESP_OK : ESP_FAIL);
    M5.Display = display;
    M5.begin(cfg);
    // A zero led_brightness does not initialize the LED in M5Unified. Set the
    // active-low pin high explicitly and retain that off level during sleep.
    ESP_ERROR_CHECK(gpio_set_level(kStatusLed, 1));
    ESP_ERROR_CHECK(gpio_set_direction(kStatusLed, GPIO_MODE_OUTPUT));
    ESP_ERROR_CHECK(gpio_hold_dis(kStatusLed));
    // EXT0 wake leaves the pad in RTC mode; return it to digital input before
    // servicing buttons. GPIO38 has an external pull-up on CoreInk.
    ESP_ERROR_CHECK(rtc_gpio_deinit(kButton));
    ESP_ERROR_CHECK(gpio_set_direction(kButton, GPIO_MODE_INPUT));
    for(auto pin:{kWheelUp,kWheelDown}) {
        ESP_ERROR_CHECK(rtc_gpio_deinit(pin));
        ESP_ERROR_CHECK(gpio_set_direction(pin,GPIO_MODE_INPUT));
        ESP_ERROR_CHECK(gpio_wakeup_enable(pin,GPIO_INTR_LOW_LEVEL));
    }
    ESP_ERROR_CHECK(gpio_wakeup_enable(kButton,GPIO_INTR_LOW_LEVEL));
    M5.Display.setAutoDisplay(false);
    M5.Display.setEpdMode(epd_mode_t::epd_quality);
    last_refresh_ms = now_ms(); // Every restart gets the full refresh guard.

    uart_config_t uart{};
    uart.baud_rate = 115200;
    uart.data_bits = UART_DATA_8_BITS;
    uart.parity = UART_PARITY_DISABLE;
    uart.stop_bits = UART_STOP_BITS_1;
    uart.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    uart.source_clk = UART_SCLK_DEFAULT;
    ESP_ERROR_CHECK(uart_param_config(UART_NUM_0, &uart));
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0, 4096, 0, 0, nullptr, 0));
    device::storage_init();
    configured = device::load_config(config);
    if (configured) {
        device::load_cache(config,state);device::load_history(config,history);
        browsing=history.count && history.selected+1<history.count;
        view_dirty=browsing && !state.has_shown;
    }
    serial_reply("INK READY 1");
    serial_reply("INK DISPLAY init auto_refresh=0");
    char panel_info[100];
    std::snprintf(panel_info, sizeof(panel_info), "INK PANEL %s id=%08lx", display.panel_name, static_cast<unsigned long>(display.panel_id));
    serial_reply(panel_info);
    if (M5.Display.width() != 200 || M5.Display.height() != 200 || M5.getBoard() != m5::board_t::board_M5StackCoreInk) {
        serial_reply("INK ERROR wrong_board");
        while (true) { service(); vTaskDelay(pdMS_TO_TICKS(20)); }
    }
    // Reset gives a USB provisioning window. Normal timer wakes skip it.
    if (esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_UNDEFINED) wait_until(now_ms() + 8000);
    if (!configured) {
        show_local("USB setup\nConnect computer");
        while (true) { service(); if (request_status) show_status(); vTaskDelay(pdMS_TO_TICKS(20)); }
    }
    device::network_init();
    int64_t next_poll = 0;
    uint32_t delay_seconds = 60;
    while (true) {
        service();
        if (fault_expires_ms && now_ms() >= fault_expires_ms) {
            fault_wifi = false; fault_api = false; fault_expires_ms = 0;
            request_poll = true; serial_reply("INK FAULT expired");
        }
        if(browse_delta) {
            if(full_message) { full_message=false;view_dirty=state.has_latest;last_interaction_ms=now_ms(); }
            if(ink::navigate(history,browse_delta)) {
                browsing=true;view_dirty=true;last_interaction_ms=now_ms();
                char info[80];std::snprintf(info,sizeof(info),"INK HISTORY index=%lu total=%lu",static_cast<unsigned long>(history.selected+1),static_cast<unsigned long>(history.count));serial_reply(info);
            }
            browse_delta=0;
        }
        if(request_click) {
            request_click=false;last_interaction_ms=now_ms();
            if(browsing || local_screen) {
                browsing=false;full_message=false;local_screen=false;request_poll=true;
            } else if(state.has_latest && state.latest.content.message[0]) {
                full_message=!full_message;
                if(!full_message) request_poll=true;
            } else request_poll=true;
            if(history.count) history.selected=history.count-1;
            view_dirty=state.has_latest;
            serial_reply(full_message ? "INK VIEW full_message" : "INK VIEW current");
        }
        if(view_dirty && now_ms()-last_interaction_ms>=120 && now_ms()>=refresh_retry_ms) {
            const auto content=browsing ? history.entries[history.selected].content : state.latest.content;
            if(refresh_content(content,true,full_message)) {
                if (!browsing) record_latest();
                device::save_history(config,history);
                view_dirty=false;
            }
        }
        if(view_dirty) { vTaskDelay(pdMS_TO_TICKS(20));continue; }
        if(needs_cleanup && now_ms()>=refresh_retry_ms && ink::refresh_wait(now_ms(),last_refresh_ms)==0) {
            const auto content=state.shown;
            if (!refresh_content(content,false,shown_full_message)) needs_cleanup=true;
        }
        if (request_status) show_status();
        if (!browsing && !full_message && (request_poll || now_ms() >= next_poll)) {
            request_poll = false;
            local_screen = false;
            const auto poll_start = now_ms();
            device::PollResult result;
            bool connected = !fault_wifi && device::connect_wifi(config);
            if (connected && device::sync_clock()) {
                if(!fault_api && state.has_latest && state.latest.requires_ack && state.has_shown && ink::equal(state.shown,state.latest.content)) {
                    if(device::acknowledge(config,state.latest.revision)) { state.latest.requires_ack=false;checkpoint();serial_reply("INK ACK complete"); }
                    else serial_reply("INK WARNING ack_retry");
                }
                if (fault_api) {
                    auto unreachable = config;
                    // Exercise a real failed TLS/TCP request without changing
                    // the configured origin or invalidating its offline cache.
                    std::strcpy(unreachable.base_url, "https://127.0.0.1:1");
                    result = device::poll(unreachable, state);
                    wipe(&unreachable, sizeof(unreachable));
                } else result = device::poll(config, state);
            }
            device::disconnect_wifi();
            last_status = result.status;
            if (result.status == 200) {
                bool content_changed = !state.has_latest || !ink::equal(state.latest.content, result.snapshot.content);
                ink::accept(state, result.snapshot);
                if (!ink::known_face(state.latest.content.face)) serial_reply("INK WARNING unknown_face");
                if (content_changed) checkpoint();
            } else if (result.status == 304) state.failures = 0;
            else state.failures = std::min<uint32_t>(state.failures + 1, 100);
            const int battery = M5.Power.getBatteryLevel();
            delay_seconds = ink::poll_delay(state, config, battery >= 0 && battery <= 15);
            if (state.failures) delay_seconds = std::max(delay_seconds, ink::retry_delay(state.failures, esp_random()));
            if (result.status == 401 || result.status == 403) delay_seconds = std::max<uint32_t>(delay_seconds, 900);
            delay_seconds = std::max(delay_seconds, result.retry_after);
            char diagnostic[110];
            std::snprintf(diagnostic, sizeof(diagnostic), "INK POLL status=%d retry=%lu failures=%lu heap=%lu", last_status,
                static_cast<unsigned long>(delay_seconds), static_cast<unsigned long>(state.failures),
                static_cast<unsigned long>(esp_get_free_heap_size()));
            serial_reply(diagnostic);
            char metric[130];
            std::snprintf(metric, sizeof(metric), "INK METRIC poll_ms=%lld revision=%llu battery_mv=%ld", static_cast<long long>(now_ms()-poll_start), static_cast<unsigned long long>(state.latest.revision), static_cast<long>(M5.Power.getBatteryVoltage()));
            serial_reply(metric);
            flush_display();
            if (!state.has_latest && !local_screen) {
                show_local(result.status == 404 ? "Waiting for first display\nPublish through the API" :
                    result.status == 401 || result.status == 403 ? "Reader token rejected\nCheck USB configuration" :
                    "Connection unavailable\nWill retry automatically");
            }
            next_poll = now_ms() + static_cast<int64_t>(delay_seconds) * 1000;
            // Allow button/USB actions after a poll without keeping Wi-Fi on.
            wait_until(now_ms() + 250);
        }
        if (!config.stay_awake && (!request_poll || full_message || browsing) && !request_click && !view_dirty && !request_status && !local_screen) {
            sleep_for(browsing || full_message ? 60 : std::max<int64_t>(1, (next_poll - now_ms() + 999) / 1000));
        } else if (!config.stay_awake && local_screen && !request_status && !request_poll) {
            // Status/errors also sleep; comparing shown with latest restores
            // server content even after a conditional HTTP 304.
            sleep_for(browsing || full_message ? 60 : std::max<int64_t>(1, (next_poll - now_ms() + 999) / 1000));
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }
}
