/**
 * Dates EUDR distinguées explicitement : coupure « zéro déforestation »
 * (article 2, point 13) et calendrier d'application des obligations.
 * Calendrier général des opérateurs selon la Commission européenne ; des
 * dispositions particulières peuvent dépendre de la taille et du statut.
 */
export default function EudrLegalDates() {
  return (
    <div className="space-y-2">
      <div className="inline-flex flex-wrap items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200">
        <span>Règlement (UE) 2023/1115</span>
        <span aria-hidden="true">·</span>
        <span>Date de référence « zéro déforestation » : 31/12/2020</span>
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-slate-300">
        Application des obligations EUDR : à partir du 30/12/2026 pour les opérateurs moyens et grands ;
        du 30/06/2027 pour la plupart des micro et petits opérateurs. Vérifiez les dispositions applicables
        à votre entreprise et les mises à jour officielles.
      </p>
    </div>
  );
}
