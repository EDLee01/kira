{
  "targets": [
    {
      "target_name": "kira_mac_computer_use",
      "sources": [
        "src/mac_computer_use.mm"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "NAPI_VERSION=8"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "OTHER_LDFLAGS": [
                "-framework",
                "ApplicationServices",
                "-framework",
                "AppKit"
              ]
            }
          }
        ]
      ]
    }
  ]
}
