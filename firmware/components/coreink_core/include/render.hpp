#pragma once
#include "coreink.hpp"
#include <array>
namespace ink {
using Framebuffer = std::array<uint8_t, 5000>;
void render_into(const Content& content, Framebuffer& output);
Framebuffer render(const Content& content);
bool known_face(const char* id);
} // namespace ink
