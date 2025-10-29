import React from 'react';
import Link from 'next/link';
import Layout from '../components/Layout';

const AboutPage = () => {
  const linkClasses =
    'relative inline-block text-[#4183c4] rounded cursor-pointer group no-underline';
  const hoverBgClasses =
    'absolute -inset-x-1 -inset-y-0.5 bg-[#dbeaf8] rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in';

  return (
    <Layout title="About">
      <div className="flex items-center">
        <Link href="/" className="group">
          <h1 className="relative inline-block text-lg tracking-tight font-lars font-medium italic text-labels opacity-0 animate-fade-in hover:cursor-pointer">
            <span className="block transition-opacity duration-300 ease-in group-hover:opacity-0">About</span>
            <span
              aria-hidden="true"
              className="absolute inset-0 flex items-center transition-opacity duration-300 ease-in opacity-0 group-hover:opacity-100 pointer-events-none"
            >
              Back
            </span>
          </h1>
        </Link>
      </div>
      <div className="mt-4 opacity-0 animate-fade-in animation-delay-400">
        <div className="space-y-4 text-lg tracking-tight">
          <p>I was born and raised in Springfield, MO, and now reside in New York, NY.</p>
          <p>
            I currently work as a Product Designer at{' '}
            <a href="https://www.mongodb.com" target="_blank" rel="noopener noreferrer" className={linkClasses}>
              <span className="relative z-10">MongoDB</span>
              <span aria-hidden="true" className={hoverBgClasses}></span>
            </a>{' '}
            on the Data Core team, where I focus on improving the developer experience for MongoDB&apos;s flagship
            Atlas platform. Previously, I&apos;ve done design work for{' '}
            <a href="https://andalusia-labs.com" target="_blank" rel="noopener noreferrer" className={linkClasses}>
              <span className="relative z-10">Andalusia Labs</span>
              <span aria-hidden="true" className={hoverBgClasses}></span>
            </a>{' '}
            and{' '}
            <a href="https://www.salesforce.com" target="_blank" rel="noopener noreferrer" className={linkClasses}>
              <span className="relative z-10">Salesforce</span>
              <span aria-hidden="true" className={hoverBgClasses}></span>
            </a>
            .
          </p>
          <p>
            I&apos;ve always loved beautiful interfaces and products. As a result, I&apos;m deeply interested in all of
            the small visual details that result in a well-crafted product.
          </p>
          <p>Otherwise, I love to cook with friends, play basketball, and obsess over the NBA.</p>
          <p>
            Connect with me{' '}
            <a href="https://www.linkedin.com/in/su-jeff/" target="_blank" rel="noopener noreferrer" className={linkClasses}>
              <span className="relative z-10">@JeffreySu</span>
              <span aria-hidden="true" className={hoverBgClasses}></span>
            </a>{' '}
            or{' '}
            <a href="mailto:jeffanatorsu@gmail.com" className={linkClasses}>
              <span className="relative z-10">jeffanatorsu@gmail.com</span>
              <span aria-hidden="true" className={hoverBgClasses}></span>
            </a>
            .
          </p>
        </div>
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
