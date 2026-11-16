import { Legal } from "../legal";

export const metadata = { title: "Conditions d'utilisation · Hooklip" };

export default function TermsPage() {
  return (
    <Legal title="Conditions d'utilisation" updated="16 novembre 2026">
      <p>En créant un compte sur Hooklip, tu acceptes les règles ci-dessous.</p>

      <h2>Le service</h2>
      <p>
        Hooklip importe des vidéos, y repère des moments, les monte en clips verticaux sous-titrés et les publie sur les comptes que tu
        connectes. Le service est fourni tel quel, sans garantie de disponibilité ni de résultat : un score de potentiel ou une estimation de
        coût reste indicatif.
      </p>

      <h2>Ton contenu</h2>
      <ul>
        <li>Tu n&apos;importes que des vidéos dont tu détiens les droits, ou pour lesquelles tu as l&apos;autorisation du créateur.</li>
        <li>Tu restes propriétaire de tes vidéos et de tes clips. Hooklip ne les utilise que pour te fournir le service.</li>
        <li>Tu es responsable de ce que tu publies : titres, descriptions, musique et contenu du clip.</li>
      </ul>

      <h2>Les réseaux</h2>
      <ul>
        <li>
          Chaque publication respecte les règles du réseau visé : <a href="https://www.youtube.com/t/terms">YouTube</a>,{" "}
          <a href="https://www.tiktok.com/legal/terms-of-service">TikTok</a> et{" "}
          <a href="https://help.instagram.com/581066165581870">Instagram</a>.
        </li>
        <li>Hooklip ne publie que sur les comptes que tu as connectés toi-même, et seulement quand tu le demandes ou le planifies.</li>
        <li>Tu peux retirer l&apos;accès d&apos;un compte à tout moment depuis l&apos;onglet Réseaux.</li>
      </ul>

      <h2>Clé API Claude</h2>
      <p>
        L&apos;analyse par Claude et les textes de publication utilisent ta propre clé API. Les appels sont facturés par Anthropic sur ton compte
        Anthropic, à son tarif. Le budget mensuel réglé dans Hooklip est une protection, pas une garantie de plafond de facturation.
      </p>

      <h2>Ton compte</h2>
      <ul>
        <li>Garde ton mot de passe pour toi. Tu es responsable de l&apos;usage fait de ton compte.</li>
        <li>Un compte utilisé pour du contenu illégal, du spam ou pour contourner les règles d&apos;un réseau peut être suspendu ou supprimé.</li>
        <li>Tu peux demander la suppression de ton compte à tout moment.</li>
      </ul>

      <h2>Évolution</h2>
      <p>Ces conditions peuvent changer. La date en haut de page indique la dernière version ; continuer à utiliser le service vaut acceptation.</p>
    </Legal>
  );
}
