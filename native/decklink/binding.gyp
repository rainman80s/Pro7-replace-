# Reach Presenter DeckLink output addon. UNVERIFIED: written without the SDK or hardware; build it on the Mac.
#   DECKLINK_SDK_DIR=".../Blackmagic DeckLink SDK 14.x/Mac/include" npm run build:decklink
# The SDK is NOT in this repo (it has its own licence and a registration download). We only compile the
# SDK's own DeckLinkAPIDispatch.cpp, which loads /Library/Frameworks/DeckLinkAPI.framework (installed by
# Desktop Video) at RUNTIME. That is how Blackmagic's samples do it, and it means the addon still loads
# when the drivers are missing, so the app can say "DeckLink driver not installed" instead of crashing.
{
  "variables": {
    "decklink_sdk%": "<!(node -p \"process.env.DECKLINK_SDK_DIR || ''\")"
  },
  "targets": [
    {
      "target_name": "reach_decklink",
      "sources": [
        "src/decklink_addon.cc",
        "<(decklink_sdk)/DeckLinkAPIDispatch.cpp"
      ],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "<(decklink_sdk)"
      ],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS", "NODE_ADDON_API_DISABLE_DEPRECATED"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17", "-fexceptions", "-O2"],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "11.0",
            "GCC_OPTIMIZATION_LEVEL": "2",
            "OTHER_LDFLAGS": ["-framework", "CoreFoundation"]
          }
        }],
        ["OS=='linux'", { "libraries": ["-ldl", "-lpthread"] }]
      ]
    }
  ]
}
