import React from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import BackTitle from "../../components/BackTitle";
import { neutralLinkClasses, NeutralLinkLabel } from "../../components/NeutralLink";

const LabPage = () => {
  return (
    <Layout title="Lab">
      <div className="pb-24 md:pb-0">
        <BackTitle href="/">Labs</BackTitle>
        <p className="mt-4 text-lg tracking-tight opacity-0 animate-reveal animation-delay-200">
          <Link href="https://ff.sujeff.com" className={neutralLinkClasses}>
            <NeutralLinkLabel underline>League analysis</NeutralLinkLabel>
          </Link>
          <span className="block text-stone-400 dark:text-stone-400">Power ranks, WAR-style player values and trade math for a Sleeper league.</span>
        </p>
      </div>
    </Layout>
  );
};

export default LabPage;
