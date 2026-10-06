import React from "react";
import Link from "next/link";
import Layout from "../../components/Layout";

const LabPage = () => {
  return (
    <Layout title="Lab">
      <div className="pb-24 md:pb-0">
        <div className="flex items-center">
          <Link href="/" className="group">
            <h1 className="relative inline-block text-lg tracking-tight font-lars font-medium italic text-stone-900 dark:text-stone-100 opacity-0 animate-reveal hover:cursor-pointer">
              <span className="block transition-opacity duration-300 ease-in group-hover:opacity-0">
                Labs
              </span>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center transition-opacity duration-300 ease-in opacity-0 group-hover:opacity-100 pointer-events-none"
              >
                Back
              </span>
            </h1>
          </Link>
        </div>
        <div className="mt-4 border border-stone-200 dark:border-stone-800 rounded-lg p-4 opacity-0 animate-reveal animation-delay-200">
          <div className="text-xs uppercase tracking-[0.35em] text-stone-400 dark:text-stone-500">
            fantasy football
          </div>
          <p className="mt-4 text-lg tracking-tight">
            <Link href="/fantasy" className="underline decoration-stone-400 dark:decoration-stone-500">
              League analysis
            </Link>
            <span className="block text-stone-400 dark:text-stone-400">Power ranks, WAR-style player values and trade math for a Sleeper league.</span>
          </p>
        </div>
      </div>
    </Layout>
  );
};

export default LabPage;
