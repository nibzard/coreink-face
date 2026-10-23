#pragma once
#include <M5GFX.h>

namespace device {
// M5GFX's CoreInk M09 panel marks its whole framebuffer dirty during init.
// Its default automatic display then refreshes uninitialized RAM at endWrite,
// even with init_without_reset(false). Disable that *before* panel init.
class CoreInkDisplay : public M5GFX {
public:
    uint32_t panel_id = 0;
    const char* panel_name = "unknown";
    bool prepare() {
        _board = autodetect(false, m5gfx::board_t::board_M5StackCoreInk);
        if (_board != m5gfx::board_t::board_M5StackCoreInk || !getPanel()) return false;
        panel_id = read_id(0x2F);
        if (panel_id == 0x00010001) panel_name = "GDEW0154D67";
        else { panel_id = read_id(0x70); panel_name = "GDEW0154M09"; }
        setAutoDisplay(false);
        setEpdMode(lgfx::epd_mode_t::epd_quality);
        if (!lgfx::LGFX_Device::init_impl(false, false)) return false;
        // This CoreInk panel's controller polarity is opposite the framebuffer
        // convention (one means black). Keep white paper and black artwork/text.
        invertDisplay(true);
        return true;
    }
    bool prepare_refresh() {
        // Every explicit whole-screen update starts from a reset controller.
        // Reusing the driver's previous frame-bank/old-image state produced a
        // correct first frame but inverted subsequent updates on this device.
        // Auto-display stays disabled, so reset/init itself never refreshes glass.
        setAutoDisplay(false);
        if (!getPanel()->init(true)) return false;
        invertDisplay(true);
        return true;
    }
private:
    uint32_t read_id(uint8_t command) {
        auto bus = getPanel()->getBus();
        bus->beginTransaction();
        lgfx::gpio_hi(9);
        bus->writeCommand(0, 8);
        bus->wait();
        lgfx::gpio_lo(9);
        bus->writeCommand(command, 8);
        bus->beginRead(0);
        auto result = bus->readData(32);
        bus->endTransaction();
        lgfx::gpio_hi(9);
        return result;
    }
};
} // namespace device
