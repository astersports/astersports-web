/**
 * Terms of Service page
 * Design: Celestial Cartography — dark constellation-themed aesthetic
 */

import { ArrowLeft } from "lucide-react";

const LOGO_URL = "/manus-storage/aster_sports_logo_high_res_2b537f86.png";

export default function Terms() {
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
            Back to Home
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
            Terms of Service
          </h1>
          <p className="text-sm text-slate-400 mb-10">Last updated: June 2025</p>

          <div className="space-y-8 text-slate-300 leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Services
              </h2>
              <p>
                Aster Sports ("we," "us," or "our") provides custom web development, website
                maintenance, hosting, and related digital services. By engaging our services,
                you agree to these terms.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Project Agreements
              </h2>
              <p>
                All projects are governed by individual project agreements or proposals that
                outline scope, timeline, deliverables, and pricing. These terms supplement
                any project-specific agreements.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Payment Terms
              </h2>
              <p>
                Payment terms are specified in individual project agreements. Unless otherwise
                stated, invoices are due within 30 days of receipt. We reserve the right to
                pause work on projects with outstanding balances.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Intellectual Property
              </h2>
              <p>
                Upon full payment, clients receive ownership of all custom code, designs, and
                content created specifically for their project. We retain the right to use
                non-confidential aspects of the work in our portfolio.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Client Responsibilities
              </h2>
              <p>
                Clients are responsible for providing necessary content, feedback, and approvals
                in a timely manner. Delays in client-provided materials may affect project
                timelines.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Limitation of Liability
              </h2>
              <p>
                Our liability is limited to the amount paid for services. We are not liable for
                indirect, incidental, or consequential damages arising from the use of our
                services or deliverables.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Termination
              </h2>
              <p>
                Either party may terminate a project agreement with 30 days written notice.
                Upon termination, the client is responsible for payment of all work completed
                up to the termination date.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Governing Law
              </h2>
              <p>
                These terms are governed by the laws of the State of New York. Any disputes
                shall be resolved in the courts of Westchester County, New York.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3" style={{ fontFamily: "var(--font-display)" }}>
                Contact
              </h2>
              <p>
                For questions about these terms, please contact us at{" "}
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
