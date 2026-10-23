idf_component_register(SRCS "coreink.cpp" "render.cpp" "cache.cpp" "http_body.cpp" INCLUDE_DIRS "include" REQUIRES json)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
