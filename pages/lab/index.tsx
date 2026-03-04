import React, { useEffect, useState } from "react";
import Link from "next/link";
import Layout from "../../components/Layout";
import LabHeaderExperiment01 from "../../components/LabHeaderExperiment01";
import NameplateBoard from "../../components/labs/nameplate/NameplateBoard";
import { fetchNameplates } from "../../components/labs/nameplate/api";
import { NameplateData } from "../../components/labs/nameplate/types";

const LabPage = () => {
  const [plates, setPlates] = useState<NameplateData[]>([]);

  useEffect(() => {
    fetchNameplates().then(setPlates);
  }, []);

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
            header experiment 01
          </div>
          <div className="mt-4">
            <LabHeaderExperiment01 />
          </div>
        </div>
        <Link
          href="/lab/nameplate"
          className="block mt-4 border border-stone-200 dark:border-stone-800 rounded-lg p-4 opacity-0 animate-reveal animation-delay-400 group hover:border-stone-400 dark:hover:border-stone-600 transition-colors"
        >
          <div className="text-xs uppercase tracking-[0.35em] text-stone-400 dark:text-stone-500">
            visitors
          </div>
          <div className="mt-3 h-48 rounded-md overflow-hidden pointer-events-none">
            <NameplateBoard plates={plates} frameless />
          </div>
        </Link>
      </div>
    </Layout>
  );
};

export default LabPage;
