import "../styles/globals.css";
import "../styles/fonts.css";
import "../components/labs/nameplate/effects.css";
import "../components/labs/nameplate/y2k-ui.css";
import type { AppProps } from "next/app";

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

export default MyApp;
