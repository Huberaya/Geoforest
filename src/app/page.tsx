import Link from "next/link";

function TreeMark() {
  return (
    <svg
      width="30"
      height="36"
      viewBox="0 0 30 36"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 2 3 21h7l-4 7h18l-4-7h7L15 2ZM15 16v19"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PublicHome() {
  return (
    <div className="public-home">
      <a className="public-skip" href="#contenu">
        Aller au contenu
      </a>
      <header className="public-header">
        <Link
          href="/"
          className="public-brand"
          aria-label="GeoForest Trace, accueil"
        >
          <TreeMark />
          <span>
            GeoForest <strong>Trace</strong>
          </span>
        </Link>
        <nav aria-label="Navigation principale">
          <Link
            href="/sign-in"
            prefetch={false}
            className="public-login"
            aria-label="Se connecter en toute sécurité"
          >
            Se connecter
          </Link>
          <Link href="/sign-up" prefetch={false} className="public-cta">
            Créer un compte <span aria-hidden="true">↗</span>
          </Link>
        </nav>
      </header>
      <main id="contenu">
        <section className="public-hero">
          <div className="public-intro">
            <p className="public-eyebrow">
              <span /> TRAÇABILITÉ & DILIGENCE RAISONNÉE
            </p>
            <h1>
              De la parcelle
              <br />à une décision
              <br />
              <em>documentée.</em>
            </h1>
            <p className="public-lead">
              Rassemblez vos fournisseurs, vos parcelles et vos justificatifs
              dans un même espace de travail. Préparez votre démarche EUDR avec
              des preuves et une validation humaine.
            </p>
            <div className="public-actions">
              <Link href="/sign-up" prefetch={false} className="public-cta">
                Créer mon compte <span aria-hidden="true">→</span>
              </Link>
              <Link
                href="/sign-in"
                prefetch={false}
                className="public-secondary"
              >
                J’ai déjà un compte
              </Link>
            </div>
            <p className="public-access-note">
              Déjà connecté ?{" "}
              <Link href="/espace" prefetch={false}>
                Accéder à mon espace
              </Link>
            </p>
          </div>
          <div
            className="public-visual"
            aria-label="Illustration du parcours, de la parcelle à la revue humaine"
          >
            <div className="public-map" aria-hidden="true">
              <svg viewBox="0 0 480 380" fill="none">
                <path
                  d="M-30 60C80-50 190 100 330 20S540 40 500 150M-40 100C80-10 190 140 330 60S540 80 500 190M-40 140C80 30 190 180 330 100S540 120 500 230M-40 180C80 70 190 220 330 140S540 160 500 270M-40 220C80 110 190 260 330 180S540 200 500 310M-40 260C80 150 190 300 330 220S540 240 500 350M-40 300C80 190 190 340 330 260S540 280 500 390M-40 340C80 230 190 380 330 300S540 320 500 430"
                  stroke="#b8c9ad"
                  strokeWidth="1.3"
                />
                <path
                  d="m110 146 120-36 98 80-36 111-131-13-66-78Z"
                  fill="#52704b"
                  fillOpacity=".14"
                  stroke="#42633c"
                  strokeWidth="2"
                  strokeDasharray="6 5"
                />
                <path
                  d="m162 183 68-21 52 49-21 58-73-7-34-42Z"
                  fill="#42633c"
                  fillOpacity=".25"
                  stroke="#42633c"
                  strokeWidth="2"
                />
                <circle cx="230" cy="162" r="5" fill="#42633c" />
                <circle cx="162" cy="183" r="5" fill="#42633c" />
                <circle cx="282" cy="211" r="5" fill="#42633c" />
              </svg>
              <span className="public-map-label">01 / LOCALISER</span>
            </div>
            <div className="public-evidence">
              <span className="public-evidence-icon" aria-hidden="true">
                ↳
              </span>
              <div>
                <small>02 / RASSEMBLER</small>
                <strong>Des preuves reliées à vos parcelles</strong>
                <span>Documents · Sources · Historique</span>
              </div>
            </div>
            <div className="public-review">
              <span aria-hidden="true">◎</span>
              <div>
                <small>03 / DÉCIDER</small>
                <strong>Une revue humaine, traçable</strong>
              </div>
            </div>
            <p className="public-illustration-note">
              Illustration du parcours — aucun résultat d’analyse présenté.
            </p>
          </div>
        </section>
        <section
          className="public-pillars"
          aria-label="Votre espace de travail"
        >
          <article>
            <span className="public-number">01</span>
            <h2>Vos partenaires</h2>
            <p>
              Structurez les informations fournisseurs et facilitez la collecte
              par un portail dédié.
            </p>
          </article>
          <article>
            <span className="public-number">02</span>
            <h2>Vos parcelles et preuves</h2>
            <p>
              Reliez les géolocalisations, les documents et les observations à
              vos dossiers.
            </p>
          </article>
          <article>
            <span className="public-number">03</span>
            <h2>Vos décisions</h2>
            <p>
              Documentez les contrôles, les actions et les validations de
              diligence raisonnée.
            </p>
          </article>
        </section>
        <aside className="public-disclaimer">
          <strong>Un outil d’aide, pas une certification.</strong>
          <p>
            GeoForest accompagne la préparation de vos dossiers. Les
            observations techniques ne suffisent pas, à elles seules, à établir
            la conformité EUDR. Aucun dépôt officiel n’est effectué
            automatiquement.
          </p>
        </aside>
      </main>
      <footer className="public-footer">
        <span>GeoForest Trace · Traçabilité documentée</span>
        <div>
          <Link href="/sign-up" prefetch={false}>
            Créer un compte
          </Link>
          <Link href="/sign-in" prefetch={false}>
            Se connecter
          </Link>
          <Link href="/portail">Portail fournisseur</Link>
        </div>
        <p>
          La création d’un compte ne donne pas automatiquement accès à une
          organisation.
        </p>
      </footer>
    </div>
  );
}
