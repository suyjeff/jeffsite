import React from 'react';
import Layout from '../components/Layout';

const AboutPage = () => {
  return (
    <Layout title="About">
      <div className="flex items-center">
        <h1 className="relative inline-block text-lg tracking-tight font-lars font-medium italic text-labels opacity-0 animate-fade-in group hover:cursor-pointer">
          <span className="block transition-opacity duration-300 ease-in group-hover:opacity-0">About</span>
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center transition-opacity duration-300 ease-in opacity-0 group-hover:opacity-100 pointer-events-none"
          >
            Back
          </span>
        </h1>
      </div>
      <div className="mt-4 opacity-0 animate-fade-in animation-delay-400">
        <p className="text-lg tracking-tight">
            I was born in Springfield, MO and now reside in New York, NY.

            I work as a product designer at MongoDB on the Data Core team crafting better experiences for our developers.
        </p>
      </div>

      <div className="mt-8">
        <div className="opacity-0 animate-fade-in animation-delay-600">
          <h2 className="text-lg tracking-tight font-bold mb-4">Education</h2>
          <ul className="space-y-4 text-lg tracking-tight">
            {[
              { degree: "B.S. in Computer Science", school: "Washington University in St. Louis", year: 2022 }            ].map((edu, index) => (
              <li key={index} className={`opacity-0 animate-fade-in animation-delay-${800 + index * 200}`}>
                <p className="underline inline-block rounded">{edu.degree}</p>
                <p>{edu.school}, {edu.year}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Layout>
  );
};

export default AboutPage;