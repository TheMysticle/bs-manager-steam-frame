import { BbmCategories, BbmFullMod, BbmPlatform, BbmStatus } from "../../../shared/models/mods/mod.interface";

/**
 * Experimental, hand-maintained mod list for Beat Saber 1.45.1 (Unity 6000.3.19f1).
 *
 * BeatMods has no entries for 1.45.1 at all (confirmed via the BSMG Discord: nobody has
 * published anything for this version yet). These are private ports, verified to build
 * cleanly against 1.45.1's actual assemblies but NOT yet verified in-headset -- see each
 * fork's README/commit history for exactly what changed and why:
 *   - https://github.com/TheMysticle/SiraUtil
 *   - https://github.com/TheMysticle/BeatSaberMarkupLanguage
 *   - https://github.com/TheMysticle/SongCore
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
    ];
}
