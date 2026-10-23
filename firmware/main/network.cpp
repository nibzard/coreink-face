#include "network.hpp"
#include "http_body.hpp"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <new>
#include <strings.h>

namespace device {
namespace {
EventGroupHandle_t events;
bool running = false;
constexpr EventBits_t kConnected = BIT0;
void event(void*, esp_event_base_t base, int32_t id, void*) {
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) xEventGroupSetBits(events, kConnected);
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) xEventGroupClearBits(events, kConnected);
}
struct Response {
    char body[ink::kBodyBytes + 1]{};
    size_t length = 0;
    char etag[128]{};
    uint32_t retry_after = 0;
    int64_t deadline_us = 0;
    bool invalid = false;
};
esp_err_t http_event(esp_http_client_event_t* event) {
    auto& r = *static_cast<Response*>(event->user_data);
    if (esp_timer_get_time() > r.deadline_us) { r.invalid = true; return ESP_FAIL; }
    if (event->event_id == HTTP_EVENT_ON_HEADER) {
        if (!strcasecmp(event->header_key, "ETag")) {
            size_t len = std::strlen(event->header_value);
            if (len >= sizeof(r.etag) || r.etag[0]) { r.invalid = true; return ESP_FAIL; }
            std::memcpy(r.etag, event->header_value, len + 1);
        }
        if (!strcasecmp(event->header_key, "Retry-After")) {
            char* end = nullptr;
            unsigned long n = std::strtoul(event->header_value, &end, 10);
            if (end != event->header_value && !*end) r.retry_after = std::clamp(n, 15UL, 3600UL);
        }
    }
    return ESP_OK;
}
}
void network_init() {
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    events = xEventGroupCreate();
    if (!events) abort();
    wifi_init_config_t config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&config));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, event, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, event, nullptr));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
}
bool connect_wifi(const ink::Config& c) {
    wifi_config_t config{};
    std::memcpy(config.sta.ssid, c.ssid, std::strlen(c.ssid));
    std::memcpy(config.sta.password, c.password, std::strlen(c.password));
    xEventGroupClearBits(events, kConnected);
    if (esp_wifi_set_config(WIFI_IF_STA, &config) != ESP_OK) return false;
    if (esp_wifi_start() != ESP_OK) return false;
    running = true;
    if (esp_wifi_connect() != ESP_OK) return false;
    return (xEventGroupWaitBits(events, kConnected, pdFALSE, pdFALSE, pdMS_TO_TICKS(20000)) & kConnected) != 0;
}
void disconnect_wifi() { if (running) { esp_wifi_stop(); running = false; } }
bool sync_clock() {
    // IDF's RTC time survives deep sleep, so most wake cycles need no SNTP.
    if (std::time(nullptr) >= 1735689600) return true;
    esp_sntp_config_t config = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    if (esp_netif_sntp_init(&config) != ESP_OK) return false;
    bool ok = esp_netif_sntp_sync_wait(pdMS_TO_TICKS(10000)) == ESP_OK;
    esp_netif_sntp_deinit();
    return ok && std::time(nullptr) >= 1735689600;
}
bool acknowledge(const ink::Config& c,uint64_t revision) {
    char url[400],body[64],auth[sizeof(c.token)+8];
    std::snprintf(url,sizeof(url),"%s/v1/devices/%s/display/ack",c.base_url,c.device_id);
    std::snprintf(body,sizeof(body),"{\"revision\":%llu}",static_cast<unsigned long long>(revision));
    std::snprintf(auth,sizeof(auth),"Bearer %s",c.token);
    esp_http_client_config_t options{};options.url=url;options.method=HTTP_METHOD_POST;
    options.timeout_ms=12000;options.crt_bundle_attach=esp_crt_bundle_attach;options.disable_auto_redirect=true;
    auto client=esp_http_client_init(&options);if(!client) return false;
    esp_http_client_set_header(client,"Authorization",auth);
    esp_http_client_set_header(client,"Content-Type","application/json");
    esp_http_client_set_header(client,"User-Agent","CoreInkFaces/0.2.0");
    const int length=std::strlen(body);
    bool ok=esp_http_client_open(client,length)==ESP_OK;
    if(ok) ok=esp_http_client_write(client,body,length)==length;
    if(ok) ok=esp_http_client_fetch_headers(client)>=0 && esp_http_client_get_status_code(client)==204;
    // No response body is needed; close immediately, including for errors/redirects.
    esp_http_client_close(client);esp_http_client_cleanup(client);std::memset(auth,0,sizeof(auth));return ok;
}
PollResult poll(const ink::Config& c, const ink::State& state) {
    PollResult result;
    // Response buffer is heap allocated to leave the main task's stack bounded.
    auto r = new (std::nothrow) Response{};
    if (!r) return result;
    r->deadline_us = esp_timer_get_time() + 20000000;
    char url[400];
    std::snprintf(url, sizeof(url), "%s/v1/devices/%s/display", c.base_url, c.device_id);
    esp_http_client_config_t config{};
    config.url = url;
    config.timeout_ms = 12000;
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.disable_auto_redirect = true;
    config.event_handler = http_event;
    config.user_data = r;
    config.buffer_size = 1024;
    config.buffer_size_tx = 1024;
    auto client = esp_http_client_init(&config);
    if (!client) { delete r; return result; }
    char auth[sizeof(c.token) + 8];
    std::snprintf(auth, sizeof(auth), "Bearer %s", c.token);
    esp_http_client_set_header(client, "Authorization", auth);
    esp_http_client_set_header(client, "Accept", "application/json");
    esp_http_client_set_header(client, "User-Agent", "CoreInkFaces/0.1.0");
    if (state.has_latest && state.latest.etag[0]) esp_http_client_set_header(client, "If-None-Match", state.latest.etag);
    // Read explicitly rather than using perform(): IDF ignores ON_DATA callback
    // return values, so an oversized or continuously streamed body would otherwise
    // keep downloading even after the callback marks it invalid.
    auto remaining_ms = [&]() -> int {
        return static_cast<int>(std::max<int64_t>(0, (r->deadline_us - esp_timer_get_time()) / 1000));
    };
    bool ok = esp_http_client_open(client, 0) == ESP_OK;
    int64_t content_length = -1;
    if (ok && remaining_ms() > 0) {
        esp_http_client_set_timeout_ms(client, remaining_ms());
        content_length = esp_http_client_fetch_headers(client);
        ok = content_length >= 0 && !r->invalid && remaining_ms() > 0;
    } else ok = false;
    int status = esp_http_client_get_status_code(client);
    if (ok && status == 200) {
        if (content_length > static_cast<int64_t>(ink::kBodyBytes)) ok = false;
        ink::BodyReader reader{
            client,
            [](void* ctx, char* output, size_t cap, uint32_t timeout) {
                auto handle = static_cast<esp_http_client_handle_t>(ctx);
                esp_http_client_set_timeout_ms(handle, timeout);
                return esp_http_client_read(handle, output, cap);
            },
            [](void* ctx) { return esp_http_client_is_complete_data_received(static_cast<esp_http_client_handle_t>(ctx)); },
            [](void*) { return esp_timer_get_time() / 1000; },
        };
        if (ok) ok = ink::read_body(reader, r->body, ink::kBodyBytes, r->length, r->deadline_us / 1000);
    }
    if (ok && !r->invalid && remaining_ms() > 0) {
        result.status = status;
        result.retry_after = r->retry_after;
        if (status == 200 && !ink::parse_snapshot(r->body, r->length, r->etag, result.snapshot)) result.status = -1;
        if (status == 304 && !state.has_latest) result.status = -1;
    }
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    std::memset(auth, 0, sizeof(auth));
    delete r;
    return result;
}
} // namespace device
