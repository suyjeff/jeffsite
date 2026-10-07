import "../styles/globals.css";
import "../styles/fonts.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "../styles/fantasy.css";
import type { AppProps } from "next/app";

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

export default MyApp;
