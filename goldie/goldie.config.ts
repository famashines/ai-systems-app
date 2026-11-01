import { fileURLToPath } from "node:url";

const APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

const config = {
  appRoot: APP_ROOT,
  appPath: "",
  bundleId: "com.famashines.ai",

  android: {
    appPath: "../android/app/build/outputs/apk/release/app-release.apk",
    applicationId: "com.famashines.ai"
  },

  devices: ["pixel-10-pro"],
  locales: ["en-US"],
  appearance: "light",

  frame: { variant: "17-pro-blue" },

  theme: {
    background: "linear-gradient(135deg, #2F5BB7 0%, #284777 100%)",
    headlineColor: "#FFFFFF",
    subheadColor: "#D9E2FF",
    fontFamily: "Roboto",
    fontFiles: [{ family: "Roboto", files: { 500: "../logo-master/fonts/Roboto-Variable.ttf" } }],
    copyHeightRatio: 0.24,
    deviceWidthRatio: 0.84,
    template: ["classic", "hero", "tilt", "offset"]
  },

  store: {
    name: "Fama AI",
    subtitle: { "en-US": "Your AI agents on your phone" },
    developer: "famashines",
    category: "Productivity",
    rating: 5,
    ratingCount: "New",
    ageRating: "18+",
    price: "Free",
    description: {
      "en-US":
        "Fama AI is the phone app for your own AI agents. Send a task in the chat, read the reply as it streams in, and see what each reply costs.\n\nFollow every task on one live list. Set a monthly budget cap, and see what you spent and what is left. The app is in English, German and Urdu, in light or dark."
    }
  },

  scenes: [
    {
      kind: "screenshot",
      id: "chat",
      flow: "store-01-chat",
      headline: { "en-US": "Your AI agents, in your pocket" },
      subhead: { "en-US": "Send a task in the chat. Read the reply and its cost." }
    },
    {
      kind: "screenshot",
      id: "tasks",
      flow: "store-02-tasks",
      headline: { "en-US": "Follow every task" },
      subhead: { "en-US": "Each task and its status, live, on one list." }
    },
    {
      kind: "screenshot",
      id: "budget",
      flow: "store-03-budget",
      headline: { "en-US": "Stay inside your budget" },
      subhead: { "en-US": "Set a monthly cap. See what you spent and what is left." }
    },
    {
      kind: "screenshot",
      id: "settings",
      flow: "store-04-settings",
      headline: { "en-US": "Your language, your theme" },
      subhead: { "en-US": "English, German or Urdu, in light or dark." }
    }
  ]
};

export default config;
