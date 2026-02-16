{
  "targets": [
    {
      "target_name": "centris_audio",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "sources": [
        "src/centris_audio.cc",
        "src/circular_buffer.cc",
        "src/vad_processor.cc",
        "src/stream_processor.cc",
        "src/websocket_client.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "src/audio_capture_mac.cc"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CFLAGS": [
              "-arch x86_64",
              "-arch arm64"
            ],
            "OTHER_LDFLAGS": [
              "-arch x86_64",
              "-arch arm64"
            ]
          },
          "link_settings": {
            "libraries": [
              "-framework CoreAudio",
              "-framework AudioToolbox",
              "-framework CoreFoundation",
              "-framework Security"
            ]
          },
          "defines": [
            "CENTRIS_PLATFORM_MAC"
          ]
        }],
        ["OS=='win'", {
          "sources": [
            "src/audio_capture_win.cc"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/EHsc"]
            }
          },
          "libraries": [
            "-lole32.lib",
            "-loleaut32.lib",
            "-lwinmm.lib"
          ],
          "defines": [
            "CENTRIS_PLATFORM_WIN",
            "_WIN32_WINNT=0x0A00"
          ]
        }],
        ["OS=='linux'", {
          "sources": [
            "src/audio_capture_linux.cc"
          ],
          "cflags_cc": [
            "-std=c++17",
            "-fPIC"
          ],
          "libraries": [
            "-lpulse",
            "-lpulse-simple"
          ],
          "defines": [
            "CENTRIS_PLATFORM_LINUX"
          ]
        }]
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ]
    }
  ]
}
