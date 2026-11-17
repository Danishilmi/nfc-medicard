import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

const API_TARGET = `http://localhost:${process.env.API_PORT || 4444}`;

export default defineConfig(({ mode }) => {
  // `npm run dev:phone` serves the app over HTTPS on your Wi-Fi so a phone can open it.
  // Phones only allow the camera and Web NFC on secure (https) pages; the certificate is
  // self-signed, so the phone shows a warning once that you accept.
  const phone = mode === "phone";
  return {
    plugins: [react(), ...(phone ? [basicSsl()] : [])],
    server: {
      port: 5173,
      host: phone ? true : undefined,
      // Forwards API calls when VITE_API_URL is "/api", so the browser (or a phone on the
      // same Wi-Fi) reaches the offline demo backend through this one address.
      proxy: {
        "/api": API_TARGET,
        "/demo-files": API_TARGET,
      },
    },
  };
});
