idf_component_register(SRCS "main.cpp" "storage.cpp" "network.cpp"
    INCLUDE_DIRS "."
    REQUIRES coreink_core m5unified m5gfx nvs_flash esp_wifi esp_event esp_netif
             esp_http_client esp-tls esp_timer esp_driver_uart esp_driver_gpio mbedtls)
target_compile_features(${COMPONENT_LIB} PUBLIC cxx_std_17)
