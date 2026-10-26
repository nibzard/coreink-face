#pragma once
#include "coreink.hpp"

namespace ink {
// Persist uncertainty before touching the panel. Keep failed updates pending.
template<class Checkpoint, class Paint>
bool update_display(State& state, const Content& content, Checkpoint checkpoint, Paint paint) {
    // content can refer to state.shown; preserve it across the update.
    const auto target = content;
    state.has_shown = false;
    if (!checkpoint()) return false;
    if (!paint(target)) return false;
    state.shown = target;
    state.has_shown = true;
    if (!checkpoint()) {
        state.has_shown = false;
        return false;
    }
    return true;
}
}
