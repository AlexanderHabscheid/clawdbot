{
  "targets": [
    {
      "target_name": "centris_control",
      "sources": [
        "src/centris_control.cc",
        "src/types.cc",
        "src/utils.cc",
        "src/key_codes.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_CPP_EXCEPTIONS"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      
      "conditions": [
        ["OS=='mac'", {
          "sources": [
            "src/accessibility_controller_mac.mm",
            "src/mouse_keyboard_controller_mac.mm",
            "src/window_controller_mac.mm",
            "src/screen_controller_mac.mm"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "OTHER_CFLAGS": [
              "-fobjc-arc"
            ]
          },
          "link_settings": {
            "libraries": [
              "-framework ApplicationServices",
              "-framework CoreGraphics",
              "-framework AppKit",
              "-framework Carbon",
              "-framework Foundation"
            ]
          },
          "defines": [
            "CENTRIS_PLATFORM_MAC"
          ]
        }],
        
        ["OS=='win'", {
          "sources": [
            "src/accessibility_controller_win.cc",
            "src/mouse_keyboard_controller_win.cc",
            "src/window_controller_win.cc",
            "src/screen_controller_win.cc"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          },
          "link_settings": {
            "libraries": [
              "-lUIAutomationCore.lib",
              "-luser32.lib",
              "-lole32.lib",
              "-loleaut32.lib"
            ]
          },
          "defines": [
            "CENTRIS_PLATFORM_WIN",
            "_WIN32_WINNT=0x0A00"
          ]
        }],
        
        ["OS=='linux'", {
          "sources": [
            "src/accessibility_controller_linux.cc",
            "src/mouse_keyboard_controller_linux.cc",
            "src/window_controller_linux.cc",
            "src/screen_controller_linux.cc"
          ],
          "cflags_cc": [
            "-std=c++17",
            "-fexceptions",
            "<!@(pkg-config --cflags atspi-2 x11 xtst)"
          ],
          "link_settings": {
            "libraries": [
              "<!@(pkg-config --libs atspi-2 x11 xtst)"
            ]
          },
          "defines": [
            "CENTRIS_PLATFORM_LINUX"
          ]
        }]
      ]
    }
  ]
}

