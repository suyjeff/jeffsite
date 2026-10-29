import React from "react";
import Head from "next/head";
import Layout from "../../components/Layout";
import { neutralLinkClasses, NeutralLinkLabel } from "../../components/NeutralLink";

// The fantasy app moved to its own site. Links already shared to sujeff.com/fantasy (league, season and reveal in the
// query, the section in the hash) carry on to the same place there, so this keeps both.
const APP = "https://ff.sujeff.com/";
const forward = `location.replace(${JSON.stringify(APP)} + location.search + location.hash)`;

const FantasyMoved = () => (
  <Layout title="Fantasy">
    <Head>
      <script dangerouslySetInnerHTML={{ __html: forward }} />
      {/* Link previews don't run the script, so an old link still unfurls to the app's card. */}
      <meta property="og:title" content="Weekly Power Rank" />
      <meta property="og:url" content={APP} />
      <meta property="og:image" content={`${APP}og.png`} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="robots" content="noindex" />
    </Head>
    <p className="mt-4 text-lg tracking-tight">
      Fantasy now lives at{" "}
      <a href={APP} className={neutralLinkClasses}>
        <NeutralLinkLabel underline>ff.sujeff.com</NeutralLinkLabel>
      </a>
      .
    </p>
  </Layout>
);

export default FantasyMoved;
