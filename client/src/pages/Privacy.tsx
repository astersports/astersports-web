/**
 * Privacy Policy page
 * Design: Celestial Cartography — dark constellation-themed aesthetic
 */

import { ArrowLeft } from "lucide-react";

const LOGO_URL = "/aster-mark.png";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      {/* Header */}
      <header className="bg-[#0a0e1a]/90 backdrop-blur-xl border-b border-white/5">
        <div className="container flex items-center justify-between h-16 md:h-20">
          <a href="/" className="flex items-center gap-3">
            <img src={LOGO_URL} alt="Aster Sports" className="w-10 h-10" />
            <span className="text-lg font-semibold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>
              Aster Sports
            </span>
          </a>
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-[#f5b731] transition-colors"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Aster Sports
          </a>
        </div>
      </header>

      {/* Content */}
      <main className="container py-16 md:py-24">
        <div className="max-w-3xl mx-auto">
          <h1
            className="text-3xl md:text-4xl font-bold text-white mb-8 tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Privacy Policy
          </h1>
          <p className="text-sm text-slate-400 mb-10">Last updated: June 2025</p>

          <div className="space-y-8 text-slate-300 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Information We Collect
              </h2>
              <p>
                When you contact us via email or through our website, we may collect your name,
                email address, and any information you voluntarily provide in your message. We do
                not collect personal information unless you actively submit it to us.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                How We Use Your Information
              </h2>
              <p>
                We use the information you provide solely to respond to your inquiries, deliver
                our web development services, and communicate with you about your project. We do
                not sell, rent, or share your personal information with third parties for marketing
                purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Data Security
              </h2>
              <p>
                We implement reasonable security measures to protect your personal information
                from unauthorized access, alteration, or destruction. However, no method of
                transmission over the internet is 100% secure.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Cookies & Analytics
              </h2>
              <p>
                Our website may use basic analytics to understand traffic patterns. We do not use
                tracking cookies for advertising purposes. Any analytics data collected is
                anonymized and used solely to improve our website experience.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Third-Party Services
              </h2>
              <p>
                We may use third-party services (such as hosting providers and email services)
                to operate our business. These services have their own privacy policies governing
                how they handle data.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Your Rights
              </h2>
              <p>
                You have the right to request access to, correction of, or deletion of any
                personal information we hold about you. To exercise these rights, please contact
                us at{" "}
                <a href="mailto:frank@astersports.co" className="text-[#f5b731] hover:underline">
                  frank@astersports.co
                </a>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Changes to This Policy
              </h2>
              <p>
                We may update this privacy policy from time to time. Any changes will be posted
                on this page with an updated revision date.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Contact
              </h2>
              <p>
                If you have questions about this privacy policy, please contact us at{" "}
                <a href="mailto:frank@astersports.co" className="text-[#f5b731] hover:underline">
                  frank@astersports.co
                </a>.
              </p>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
