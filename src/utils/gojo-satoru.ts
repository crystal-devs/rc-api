import fs from "fs";
import { Signale } from "signale";

const gojoArt = fs.readFileSync("./src/assets/gojo.txt", "utf8");

const signale = new Signale({
  types: {
    gojo: {
      badge: "🔵",
      color: "cyan",
      label: "Gojo Satoru",
      logLevel: "info",
    },
    slowShutdown: {
      badge: "⏳",
      color: "red",
      label: "Gojo Warning",
      logLevel: "warn",
    },
  },
});

export const logGojo = () => {
  signale.gojo("\n" + gojoArt);
  signale.success("YEYE SERVER IS RUNNING! OMEDETOOOO! 🎉🔥");
};

// New Gojo message when shutdown is slow
export const logSlowShutdown = () => {
  signale.slowShutdown(
    "😤 Why is this taking so long?! I'm getting impatient... Exiting forcefully in 5 seconds!"
  );
};
