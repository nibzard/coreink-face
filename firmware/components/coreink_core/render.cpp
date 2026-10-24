#include "render.hpp"
#include "generated/assets.hpp"
#include <cstring>

namespace ink {
static const ink_assets::Face* face(const char* id) {
    for (const auto& f : ink_assets::faces) if (!std::strcmp(id, f.id)) return &f;
    return nullptr;
}
bool known_face(const char* id) { return face(id) != nullptr; }
static const ink_assets::Glyph& glyph(uint32_t cp) {
    for (const auto& g : ink_assets::glyphs) if (g.codepoint == cp) return g;
    for (const auto& g : ink_assets::glyphs) if (g.codepoint == '?') return g;
    return ink_assets::glyphs[0];
}
uint16_t glyph_advance(uint32_t cp) { return glyph(cp).advance; }
static void blit(Framebuffer& out, const uint8_t* bits, int width, int height, int x, int y) {
    int stride = (width + 7) / 8;
    for (int row = 0; row < height; ++row) for (int col = 0; col < width; ++col)
        if (bits[row * stride + col / 8] & (0x80 >> (col % 8))) {
            int px = x + col, py = y + row;
            if (px >= 0 && px < 200 && py >= 0 && py < 200) out[py * 25 + px / 8] |= 0x80 >> (px % 8);
        }
}
void render_into(const Content& content, Framebuffer& out) {
    out.fill(0);
    auto f = face(content.face);
    if (!f) f = face("small-dots");
    blit(out, f->bits, ink_assets::face_size, ink_assets::face_size, 32, 0);
    const auto layout = layout_message(content.message);
    for (size_t i = 0; i < layout.count; ++i) {
        const auto& pos = layout.glyphs[i];
        const auto& g = glyph(pos.codepoint);
        blit(out, g.rows, ink_assets::glyph_width, ink_assets::glyph_height,
             8 + pos.x, 144 + pos.row * ink_assets::line_height);
    }
}
Framebuffer render(const Content& content) { Framebuffer out{}; render_into(content, out); return out; }
void render_full_message_into(const Content& content, Framebuffer& out) {
    out.fill(0);
    const auto layout = layout_full_message(content.message);
    const int rows = layout.count ? layout.glyphs[layout.count - 1].row + 1 : 0;
    const int top = (200 - rows * ink_assets::glyph_height) / 2;
    for (size_t i = 0; i < layout.count; ++i) {
        const auto& pos = layout.glyphs[i];
        const auto& g = glyph(pos.codepoint);
        blit(out, g.rows, ink_assets::glyph_width, ink_assets::glyph_height,
             8 + pos.x, top + pos.row * ink_assets::glyph_height);
    }
}
} // namespace ink
