import React from "react";
import Head from "next/head";
import dynamic from "next/dynamic";
import { NuqsAdapter } from "nuqs/adapters/next/pages";

// The workbench is client-only (video elements, typed arrays, keyboard), so it skips SSR; the static page ships
// a dark, fixed-size shell so there is nothing to shift when it mounts.
const Workbench = dynamic(() => import("../../components/filmroom/Workbench"), {
  ssr: false,
  loading: () => <div style={{ position: "fixed", inset: 0, background: "#090A0C" }} />,
});

export default function FilmRoomPage() {
  return (
    <>
      <Head>
        <title>Film Room</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Keyboard-first NBA possession film room: query 19,059 Warriors plays, review frame-accurate reels, stamp tactical tags." />
        <meta name="theme-color" content="#090A0C" />
        <meta name="referrer" content="no-referrer" />
        <link rel="preload" href="/filmroom/fonts/FiraCode-Variable.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/filmroom/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/filmroom/fonts/GeistSerifVF.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/filmroom/data/plays.bin.gz" as="fetch" crossOrigin="" />
        <link rel="preload" href="/filmroom/data/meta.json" as="fetch" crossOrigin="" />
        <style>{"html,body{background:#090A0C;margin:0;overflow:hidden}html{scrollbar-gutter:auto}"}</style>
      </Head>
      <NuqsAdapter>
        <Workbench />
      </NuqsAdapter>
    </>
  );
}
