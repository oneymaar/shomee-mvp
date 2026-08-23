/**
 * Mentions légales — chantier Meta Business (vérification d'entreprise).
 *
 * Cette page est la pièce que Meta croise avec le dossier : elle établit
 * publiquement que la marque SHOMEE est éditée par OMI EURL. Les chaînes
 * (raison sociale, siège) sont STRICTEMENT identiques au Kbis — le moindre
 * écart entre le site, le portefeuille Meta et le Kbis est le motif de rejet
 * n°1 de la vérification. Ne pas reformuler sans mettre à jour les trois.
 *
 * Réf. projet Cowork : claude/DOSSIER_META_BUSINESS.md.
 */

import type { Metadata } from 'next'
import Image from 'next/image'

export const metadata: Metadata = {
  title: 'Mentions légales — SHOMEE',
  description: 'Mentions légales du service SHOMEE, édité par OMI EURL.',
}

const INK = '#0a0a0a'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[15px] font-semibold" style={{ color: INK }}>
        {title}
      </h2>
      <div className="text-[14px] leading-relaxed text-neutral-600">{children}</div>
    </section>
  )
}

export default function MentionsLegalesPage() {
  return (
    <div className="min-h-dvh" style={{ background: '#FDF5F2' }}>
      <main className="mx-auto max-w-[560px] px-6 py-12 flex flex-col gap-8">
        <header className="flex flex-col gap-4">
          <Image
            src="/logo terracotta.png"
            alt="SHOMEE"
            width={48}
            height={55}
            priority
            className="object-contain"
          />
          <h1 className="text-[22px] font-bold tracking-tight" style={{ color: INK }}>
            Mentions légales
          </h1>
        </header>

        <Section title="Éditeur">
          <p>
            SHOMEE est un service édité par <strong>OMI EURL</strong>, société à
            responsabilité limitée à associé unique au capital de 1 000 €, immatriculée au
            registre du commerce et des sociétés de Paris sous le numéro{' '}
            <strong>995 291 598</strong> (R.C.S. Paris).
          </p>
          <p className="mt-2">
            Siège social : <strong>106 boulevard Diderot, 75012 Paris</strong>, France.
            <br />
            N° de TVA intracommunautaire : FR48 995 291 598.
          </p>
        </Section>

        <Section title="Directeur de la publication">
          <p>Olivier Ménart, gérant.</p>
        </Section>

        <Section title="Contact">
          <p>
            <a href="mailto:oliviermenart@gmail.com" className="underline underline-offset-2">
              oliviermenart@gmail.com
            </a>
          </p>
        </Section>

        <Section title="Hébergement">
          <p>
            Le site est hébergé par Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723,
            États-Unis —{' '}
            <a
              href="https://vercel.com"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              vercel.com
            </a>
            .
          </p>
        </Section>

        <Section title="Contenus immobiliers">
          <p>
            Les vidéos, photographies et informations relatives aux biens présentés sont
            fournies par les agences immobilières partenaires, qui déclarent disposer des
            droits et mandats nécessaires à leur diffusion. SHOMEE n’exerce aucune activité
            d’entremise ou de négociation au sens de la loi n°70-9 du 2 janvier 1970 : la mise
            en relation s’effectue directement avec l’agence en charge du bien.
          </p>
        </Section>

        <Section title="Données personnelles">
          <p>
            Les informations que vous renseignez (critères de recherche, coordonnées) sont
            utilisées pour vous présenter des biens correspondant à votre projet et, avec
            votre accord, vous mettre en relation avec les agences concernées. Vous pouvez
            exercer vos droits d’accès, de rectification et de suppression en écrivant à
            l’adresse de contact ci-dessus.
          </p>
        </Section>

        <Section title="Propriété intellectuelle">
          <p>
            La marque SHOMEE, le logo, l’interface et l’ensemble des éléments originaux du
            service sont protégés. Toute reproduction sans autorisation préalable est
            interdite.
          </p>
        </Section>
      </main>
    </div>
  )
}
