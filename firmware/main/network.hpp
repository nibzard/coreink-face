#pragma once
#include "coreink.hpp"
namespace device {
void network_init();
bool connect_wifi(const ink::Config& config);
void disconnect_wifi();
bool sync_clock();
// A result is an HTTP status, or -1 for transport/bounds/validation failure.
struct PollResult { int status = -1; uint32_t retry_after = 0; ink::Snapshot snapshot{}; };
PollResult poll(const ink::Config& config, const ink::State& state);
}
