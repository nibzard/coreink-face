#include "coreink.hpp"
#include "render.hpp"
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
int main(int argc, char** argv) {
    if (argc != 3) { std::cerr << "Usage: ink-preview snapshot.json output.pbm\n"; return 2; }
    std::ifstream file(argv[1], std::ios::binary);
    std::string json((std::istreambuf_iterator<char>(file)), {});
    ink::Snapshot snapshot;
    if (!ink::parse_snapshot(json.data(), json.size(), nullptr, snapshot)) { std::cerr << "Invalid display snapshot\n"; return 1; }
    auto frame = ink::render(snapshot.content);
    std::ofstream out(argv[2], std::ios::binary);
    out << "P4\n200 200\n";
    out.write(reinterpret_cast<const char*>(frame.data()), frame.size());
    if (!out) return 1;
    std::cout << "Rendered revision " << snapshot.revision << "\n";
}
