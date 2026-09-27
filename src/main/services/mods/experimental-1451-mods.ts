import { BbmCategories, BbmFullMod, BbmPlatform, BbmStatus } from "../../../shared/models/mods/mod.interface";

/**
 * Experimental, hand-maintained mod list for Beat Saber 1.45.1 (Unity 6000.3.19f1).
 *
 * BeatMods has no entries for 1.45.1 at all (confirmed via the BSMG Discord: nobody has
 * published anything for this version yet). These are public ports, verified to build
 * cleanly against 1.45.1's actual assemblies and confirmed working in-headset (BSIPA +
 * SiraUtil + BSML + SongCore) on real hardware -- see each fork's README/commit history
 * for exactly what changed and why:
 *   - https://github.com/TheMysticle/SiraUtil
 *   - https://github.com/TheMysticle/BeatSaberMarkupLanguage
 *   - https://github.com/TheMysticle/SongCore
 *   - https://github.com/TheMysticle/Beat-Saber-Utils
 *   - https://github.com/TheMysticle/BeatSaverSharper
 *   - https://github.com/TheMysticle/BeatSaverDownloader
 *   - https://github.com/TheMysticle/BeatSaverUpdater
 *   - https://github.com/TheMysticle/WhyIsThereNoLeaderboard
 *
 * BSIPA itself needed zero changes (it doesn't reference any game assemblies), so this
 * points at the official, unmodified 4.3.7 release straight from BeatMods' own CDN.
 *
 * `zipHash` is (ab)used to carry a full download URL instead of a real BeatMods content
 * hash for these four entries; getModDownload() in bs-mods-manager.service.ts checks for
 * that and uses it directly instead of building a `/cdn/mod/<hash>.zip` BeatMods URL.
 *
 * `dependencies` reference the `version.id` values below so bs-manager's existing
 * dependency-resolution logic pulls the right set together automatically.
 */
const now = new Date();

const BSIPA_ID = 145101;
const SIRAUTIL_ID = 145102;
const BSML_ID = 145103;
const SONGCORE_ID = 145104;
const BSUTILS_ID = 145105;
const BEATSAVERSHARP_ID = 145106;
const BEATSAVERDOWNLOADER_ID = 145107;
const BEATSAVERUPDATER_ID = 145108;
const WHYISTHERENOLEADERBOARD_ID = 145109;

const placeholderAuthor = { id: 0, username: "TheMysticle", githubId: "TheMysticle", sponsorUrl: "", displayName: "TheMysticle", bio: "" };

function fullMod(params: {
    id: number;
    name: string;
    summary: string;
    category: BbmCategories;
    gitUrl: string;
    downloadUrl: string;
    modVersion: string;
    dependencies?: number[];
}): BbmFullMod {
    return {
        mod: {
            id: params.id,
            name: params.name,
            summary: params.summary,
            description: params.summary,
            gameName: "BeatSaber",
            category: params.category,
            authors: [placeholderAuthor],
            status: BbmStatus.Verified,
            iconFileName: "",
            gitUrl: params.gitUrl,
            lastApprovedById: 0,
            lastUpdatedById: 0,
            createdAt: now,
            updatedAt: now,
        },
        version: {
            id: params.id,
            modId: params.id,
            author: placeholderAuthor,
            modVersion: params.modVersion,
            platform: BbmPlatform.UniversalPC,
            zipHash: params.downloadUrl,
            status: BbmStatus.Verified,
            dependencies: params.dependencies ?? [],
            contentHashes: [],
            supportedGameVersions: [{ id: 0, gameName: "BeatSaber", version: "1.45.1", defaultVersion: false }],
            downloadCount: 0,
        },
    };
}

export function getExperimental1451Mods(): BbmFullMod[] {
    return [
        fullMod({
            id: BSIPA_ID,
            name: "BSIPA",
            summary: "A mod loader for Beat Saber. Unmodified -- needs no changes for 1.45.1.",
            category: BbmCategories.Core,
            gitUrl: "https://github.com/nike4613/BeatSaber-IPA-Reloaded",
            downloadUrl: "https://beatmods.com/cdn/mod/947774ef1010ff809ae05e345e269a90.zip",
            modVersion: "4.3.7",
        }),
        fullMod({
            id: SIRAUTIL_ID,
            name: "SiraUtil",
            summary: "[Experimental 1.45.1 port] A powerful utility mod which provides more tools to Beat Saber modders.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/TheMysticle/SiraUtil",
            downloadUrl: "https://github.com/TheMysticle/SiraUtil/releases/download/v3.4.0-bs1.45.1/SiraUtil-3.4.0-bs1.45.1.zip",
            modVersion: "3.4.0",
            dependencies: [BSIPA_ID],
        }),
        fullMod({
            id: BSML_ID,
            name: "BeatSaberMarkupLanguage",
            summary: "[Experimental 1.45.1 port] An XML-based UI system.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/TheMysticle/BeatSaberMarkupLanguage",
            downloadUrl: "https://github.com/TheMysticle/BeatSaberMarkupLanguage/releases/download/v1.14.2-bs1.45.1/BSML-1.14.2-bs1.45.1.zip",
            modVersion: "1.14.2",
            dependencies: [BSIPA_ID],
        }),
        fullMod({
            id: SONGCORE_ID,
            name: "SongCore",
            summary: "[Experimental 1.45.1 port] A plugin for handling custom song additions in Beat Saber.",
            category: BbmCategories.Core,
            gitUrl: "https://github.com/TheMysticle/SongCore",
            downloadUrl: "https://github.com/TheMysticle/SongCore/releases/download/v3.15.3-bs1.45.1/SongCore-3.15.3-bs1.45.1.zip",
            modVersion: "3.15.3",
            dependencies: [BSIPA_ID, SIRAUTIL_ID, BSML_ID],
        }),
        fullMod({
            id: BSUTILS_ID,
            name: "BS Utils",
            summary: "[Experimental 1.45.1 port] A basic library for beat saber mods to use.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/TheMysticle/Beat-Saber-Utils",
            downloadUrl: "https://github.com/TheMysticle/Beat-Saber-Utils/releases/download/v1.14.4-bs1.45.1/BS_Utils-1.14.4-bs1.45.1-077404b.zip",
            modVersion: "1.14.4",
            dependencies: [BSIPA_ID],
        }),
        fullMod({
            id: BEATSAVERSHARP_ID,
            name: "BeatSaverSharp",
            summary: "[Experimental 1.45.1 port] A .NET library for interacting with the BeatSaver API. Unmodified upstream (Auros/BeatSaverSharper 3.4.5, Unity build) -- doesn't reference any game assemblies directly.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/TheMysticle/BeatSaverSharper",
            downloadUrl: "https://github.com/TheMysticle/BeatSaverSharper/releases/download/v3.4.5-unity/BeatSaverSharp-3.4.5-Unity.zip",
            modVersion: "3.4.5",
        }),
        fullMod({
            id: BEATSAVERDOWNLOADER_ID,
            name: "BeatSaverDownloader",
            summary: "[Experimental 1.45.1 port] Enables you to download songs from BeatSaver in-game.",
            category: BbmCategories.Core,
            gitUrl: "https://github.com/TheMysticle/BeatSaverDownloader",
            downloadUrl: "https://github.com/TheMysticle/BeatSaverDownloader/releases/download/v6.0.7-bs1.45.1/BeatSaverDownloader-6.0.7-bs1.45.1-03f6fb3.zip",
            modVersion: "6.0.7",
            dependencies: [BSIPA_ID, BSUTILS_ID, BSML_ID, SONGCORE_ID, BEATSAVERSHARP_ID],
        }),
        fullMod({
            id: BEATSAVERUPDATER_ID,
            name: "BeatSaverUpdater",
            summary: "[Experimental 1.45.1 port] Alerts you of updates to maps and updates them to the latest version.",
            category: BbmCategories.Core,
            gitUrl: "https://github.com/TheMysticle/BeatSaverUpdater",
            downloadUrl: "https://github.com/TheMysticle/BeatSaverUpdater/releases/download/v1.2.14-bs1.45.1/BeatSaverUpdater-1.2.14-bs1.45.1-a9b14c1.zip",
            modVersion: "1.2.14",
            dependencies: [BSIPA_ID, BSML_ID, SONGCORE_ID, SIRAUTIL_ID, BEATSAVERSHARP_ID],
        }),
        fullMod({
            id: WHYISTHERENOLEADERBOARD_ID,
            name: "WhyIsThereNoLeaderboard",
            summary: "[Experimental 1.45.1 port] Clarifies why leaderboards on custom songs are not supported and lets you download one.",
            category: BbmCategories.Essential,
            gitUrl: "https://github.com/TheMysticle/WhyIsThereNoLeaderboard",
            downloadUrl: "https://github.com/TheMysticle/WhyIsThereNoLeaderboard/releases/download/v1.0.3-bs1.45.1/WhyIsThereNoLeaderboard-1.0.3-bs1.45.1-ce72195.zip",
            modVersion: "1.0.3",
            dependencies: [BSIPA_ID, BSML_ID, SIRAUTIL_ID],
        }),
    ];
}
