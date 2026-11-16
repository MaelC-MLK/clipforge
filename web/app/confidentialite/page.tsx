import { CONTACT_EMAIL, Legal } from "../legal";

export const metadata = { title: "Confidentialité · Hooklip" };

export default function PrivacyPage() {
  return (
    <Legal title="Politique de confidentialité" updated="16 novembre 2026">
      <p>
        Hooklip transforme tes vidéos longues en clips verticaux et les publie sur tes comptes. Cette page explique quelles données le service
        garde, pourquoi, et comment les faire supprimer.
      </p>

      <h2>Ce que Hooklip enregistre</h2>
      <ul>
        <li>Ton adresse email et ton mot de passe, ce dernier sous forme hachée : personne ne peut le relire.</li>
        <li>Les vidéos que tu importes, les clips produits, leurs sous-titres et leurs réglages.</li>
        <li>Ta clé API Claude, si tu en ajoutes une. Elle est chiffrée et n&apos;est jamais renvoyée à ton navigateur.</li>
        <li>Pour chaque compte YouTube, TikTok ou Instagram que tu connectes : son nom, son identifiant et les jetons d&apos;accès, chiffrés.</li>
        <li>Le compte des appels à Claude (nombre de tokens, coût estimé) et les statistiques de tes publications (vues, « J&apos;aime »).</li>
        <li>Un cookie de session, nécessaire pour rester connecté. Aucun cookie publicitaire ni outil de mesure d&apos;audience.</li>
      </ul>

      <h2>À quoi servent ces données</h2>
      <p>
        Uniquement à faire fonctionner le service pour toi : importer, monter, sous-titrer, planifier et publier tes clips. Hooklip ne vend
        aucune donnée et ne s&apos;en sert pas pour de la publicité.
      </p>

      <h2>Avec qui elles sont partagées</h2>
      <ul>
        <li>
          <strong>Anthropic</strong> : quand tu demandes une analyse ou des textes de publication, la transcription du passage concerné est
          envoyée à Claude avec ta propre clé API.
        </li>
        <li>
          <strong>YouTube, TikTok, Instagram</strong> : quand tu publies, le clip et son texte sont envoyés au compte que tu as choisi. Rien
          n&apos;est publié sans une action de ta part (publication immédiate ou planifiée par toi).
        </li>
        <li>
          <strong>L&apos;hébergeur</strong> : les données sont stockées sur un serveur loué chez Hostinger.
        </li>
      </ul>

      <h2>Services d&apos;API YouTube</h2>
      <p>
        Hooklip utilise les services d&apos;API YouTube pour envoyer tes clips sur ta chaîne et lire leurs statistiques. En connectant ta chaîne,
        tu acceptes les <a href="https://www.youtube.com/t/terms">conditions d&apos;utilisation de YouTube</a> ; tes données sont aussi couvertes
        par les <a href="https://policies.google.com/privacy">règles de confidentialité de Google</a>. Tu peux retirer l&apos;accès de Hooklip à
        tout moment depuis l&apos;onglet Réseaux, ou depuis la{" "}
        <a href="https://myaccount.google.com/permissions">page des autorisations de ton compte Google</a>.
      </p>

      <h2>Durée de conservation et suppression</h2>
      <ul>
        <li>Tu peux supprimer une vidéo, un clip ou une musique à tout moment : le fichier est effacé du serveur.</li>
        <li>Déconnecter un compte dans l&apos;onglet Réseaux efface ses jetons d&apos;accès.</li>
        <li>Retirer ta clé Claude dans la page Compte l&apos;efface de la base.</li>
        <li>
          Pour supprimer ton compte et toutes ses données, ou en obtenir une copie,
          {CONTACT_EMAIL ? " écris à l'adresse de contact ci-dessous." : " contacte l'éditeur du service."} La demande est traitée sous 30 jours.
        </li>
      </ul>

      <h2>Tes droits</h2>
      <p>
        Conformément au RGPD, tu peux demander l&apos;accès à tes données, leur rectification, leur effacement ou leur export, et saisir la{" "}
        <a href="https://www.cnil.fr">CNIL</a> si tu estimes que tes droits ne sont pas respectés.
      </p>
    </Legal>
  );
}
