#pragma once
#include "coreink.hpp"
#include "history.hpp"
namespace device {
void storage_init();
bool load_history(const ink::Config& config, ink::History& history);
bool save_history(const ink::Config& config, const ink::History& history);
bool load_config(ink::Config& config);
bool save_config(const ink::Config& config);
void clear_config();
bool load_cache(const ink::Config& config, ink::State& state);
bool save_cache(const ink::Config& config, const ink::State& state);
}
