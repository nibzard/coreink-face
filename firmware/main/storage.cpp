#include "storage.hpp"
#include "cache.hpp"
#include "esp_check.h"
#include "mbedtls/sha256.h"
#include "nvs_flash.h"
#include "nvs.h"
#include <cstddef>
#include <cstring>
#include <initializer_list>
#include <memory>
#include <new>

namespace device {
namespace {
using Cache = ink::CacheRecord;
static void scope(const ink::Config& c, uint8_t out[32]) {
    // Include the token so changing credentials also invalidates prior content.
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts(&ctx, 0);
    for (const char* p : {c.base_url, c.device_id, c.token})
        mbedtls_sha256_update(&ctx, reinterpret_cast<const uint8_t*>(p), std::strlen(p) + 1);
    mbedtls_sha256_finish(&ctx, out);
    mbedtls_sha256_free(&ctx);
}
static Cache seal(const ink::Config& c, const ink::State& state) {
    uint8_t digest[32]; scope(c, digest);
    return ink::seal_cache(state, digest);
}
static bool restore(const Cache& cache, const ink::Config& c, ink::State& state) {
    uint8_t digest[32]; scope(c, digest);
    return ink::restore_cache(cache, digest, state);
}
static bool read_blob(const char* key, void* out, size_t size) {
    nvs_handle_t handle;
    if (nvs_open("coreink", NVS_READONLY, &handle) != ESP_OK) return false;
    size_t actual = size;
    auto err = nvs_get_blob(handle, key, out, &actual);
    nvs_close(handle);
    return err == ESP_OK && actual == size;
}
static bool write_blob(const char* key, const void* data, size_t size) {
    nvs_handle_t handle;
    if (nvs_open("coreink", NVS_READWRITE, &handle) != ESP_OK) return false;
    auto err = nvs_set_blob(handle, key, data, size);
    if (err == ESP_OK) err = nvs_commit(handle);
    nvs_close(handle);
    return err == ESP_OK;
}
}
void storage_init() {
    // Do not automatically erase credentials on an NVS format/storage error.
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(nvs_flash_init_partition("history"));
}
struct HistoryRecord { uint32_t version=1; uint8_t scope[32]{}; ink::History history{}; uint32_t crc=0; };
bool load_history(const ink::Config& c, ink::History& h) {
    auto record=std::unique_ptr<HistoryRecord>(new(std::nothrow) HistoryRecord{});
    if(!record) return false;
    nvs_handle_t handle;
    if(nvs_open_from_partition("history","inbox",NVS_READONLY,&handle)!=ESP_OK) return false;
    size_t size=sizeof(*record);auto err=nvs_get_blob(handle,"messages",record.get(),&size);nvs_close(handle);
    uint8_t digest[32];scope(c,digest);
    if(err!=ESP_OK || size!=sizeof(*record) || record->version!=1 || std::memcmp(digest,record->scope,32) || record->crc!=ink::crc32(record.get(),offsetof(HistoryRecord,crc)) || record->history.count>ink::kHistoryCapacity || (record->history.count && record->history.selected>=record->history.count)) return false;
    h=record->history;return true;
}
bool save_history(const ink::Config& c,const ink::History& h) {
    auto record=std::unique_ptr<HistoryRecord>(new(std::nothrow) HistoryRecord{});
    if(!record) return false;
    scope(c,record->scope);record->history=h;record->crc=ink::crc32(record.get(),offsetof(HistoryRecord,crc));
    nvs_handle_t handle;
    if(nvs_open_from_partition("history","inbox",NVS_READWRITE,&handle)!=ESP_OK) return false;
    auto err=nvs_set_blob(handle,"messages",record.get(),sizeof(*record));if(err==ESP_OK)err=nvs_commit(handle);nvs_close(handle);return err==ESP_OK;
}
bool load_config(ink::Config& c) {
    struct Record { uint32_t version; ink::Config config; uint32_t crc; } record{};
    if (!read_blob("config", &record, sizeof(record)) || record.version != 1 ||
        record.crc != ink::crc32(&record, offsetof(Record, crc))) return false;
    // Record size and CRC guarantee these are fields written by this version.
    if (!ink::valid_config(record.config)) return false;
    c = record.config; return true;
}
bool save_config(const ink::Config& c) {
    struct Record { uint32_t version; ink::Config config; uint32_t crc; } record{};
    record.version = 1; record.config = c;
    record.crc = ink::crc32(&record, offsetof(Record, crc));
    return ink::valid_config(c) && write_blob("config", &record, sizeof(record));
}
void clear_config() {
    nvs_handle_t handle;
    if (nvs_open("coreink", NVS_READWRITE, &handle) == ESP_OK) {
        ESP_ERROR_CHECK(nvs_erase_all(handle));
        ESP_ERROR_CHECK(nvs_commit(handle));
        nvs_close(handle);
    }
}
bool load_cache(const ink::Config& c, ink::State& state) {
    Cache cache{};
    return read_blob("display", &cache, sizeof(cache)) && restore(cache, c, state);
}
bool save_cache(const ink::Config& c, const ink::State& state) {
    const auto cache = seal(c, state);
    return write_blob("display", &cache, sizeof(cache));
}
} // namespace device
