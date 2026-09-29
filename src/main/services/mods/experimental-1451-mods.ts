import { BbmCategories, BbmContentHash, BbmFullMod, BbmPlatform, BbmStatus } from "../../../shared/models/mods/mod.interface";
import { RequestService } from "../request.service";
import { BsmZipExtractor } from "main/models/bsm-zip-extractor.class";
import { lastValueFrom } from "rxjs";
import crypto from "crypto";
import log from "electron-log";

/**
 * Experimental, hand-maintained mod list for Beat Saber 1.45.1 (Unity 6000.3.19f1).
 *
 * BeatMods has no entries for 1.45.1 at all (confirmed via the BSMG Discord: nobody has
 * published anything for this version yet). These are public ports, verified to build
 * cleanly against 1.45.1's actual assemblies and confirmed working in-headset (full stack,
 * including a fixed rendering bug in SongCore's loading indicator) on real hardware -- see
 * each fork's README/commit history for exactly what changed and why:
 *   - https://github.com/experimental-beatsaber-mods/SiraUtil
 *   - https://github.com/experimental-beatsaber-mods/BeatSaberMarkupLanguage
 *   - https://github.com/experimental-beatsaber-mods/SongCore
 *   - https://github.com/experimental-beatsaber-mods/Beat-Saber-Utils
 *   - https://github.com/experimental-beatsaber-mods/BeatSaverSharper
 *   - https://github.com/experimental-beatsaber-mods/BeatSaverDownloader
 *   - https://github.com/experimental-beatsaber-mods/BeatSaverUpdater
 *   - https://github.com/experimental-beatsaber-mods/WhyIsThereNoLeaderboard
 *   - https://github.com/experimental-beatsaber-mods/beatsaber-experimental-libs
 *   - https://github.com/experimental-beatsaber-mods/CustomJSONData
 *   - https://github.com/experimental-beatsaber-mods/Heck (also hosts NoodleExtensions and Chroma)
 *   - https://github.com/experimental-beatsaber-mods/LeaderboardCore
 *   - https://github.com/experimental-beatsaber-mods/pc-mod (ScoreSaber; also depends on
 *     https://github.com/experimental-beatsaber-mods/legato, compiled directly into ScoreSaber.dll
 *     rather than distributed as its own mod entry)
 *
 * CustomJSONData, Heck, NoodleExtensions, and Chroma are confirmed working on real hardware:
 * multiple V2/V3-format Noodle Extensions + Chroma maps played to completion across an extended
 * session (custom note/wall/event animation, colored lighting), no crashes. V4 beatmap-format
 * custom data (added to CustomJSONData) has not yet been tested against an actual V4-format map
 * with custom data on real hardware -- report issues if that doesn't apply correctly.
 *
 * ScoreSaber and LeaderboardCore build clean against real 1.45.1 assemblies but have NOT been
 * installed/tested on real hardware yet. ScoreSaber is also deliberately viewing-only on this
 * build: no dev token has been requested from the ScoreSaber team, so its own client-side trust
 * gate is expected to refuse score uploads (this is the correct/sanctioned behavior for an
 * unofficial build, not a bug -- see that fork's README for the research behind it). Leaderboard
 * browsing and personal stats are unaffected either way.
 *
 * Every GitHub-hosted entry below resolves its download URL and version from that repo's
 * *latest* GitHub release at request time (via the GitHub REST API), instead of a hardcoded
 * tag/filename -- push a new release to any of these repos and bs-manager picks it up on its
 * next mod-list fetch, no code change here needed. If the GitHub API call fails (offline, rate
 * limited, repo renamed, etc.) each entry falls back to the last-known-good hardcoded
 * URL/version baked in below, so a transient API problem never breaks the mod list entirely.
 *
 * BSIPA and ScoreSaberSharp aren't ours to version this way -- they point at the official,
 * unmodified BeatMods CDN directly (BSIPA needed zero changes for 1.45.1; ScoreSaberSharp is
 * closed-source and version-agnostic, confirmed byte-identical to BeatMods' own copy).
 *
 * `zipHash` is (ab)used to carry a full download URL instead of a real BeatMods content hash;
 * getModDownload() in bs-mods-manager.service.ts checks for that and uses it directly instead
 * of building a `/cdn/mod/<hash>.zip` BeatMods URL.
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
const CUSTOMJSONDATA_ID = 145112;
const HECK_ID = 145113;
const NOODLEEXTENSIONS_ID = 145114;
const CHROMA_ID = 145115;
const INIPARSER_ID = 145110;
const SCORESABERSHARP_ID = 145111;
const LEADERBOARDCORE_ID = 145116;
const SCORESABER_ID = 145117;

const placeholderAuthor = { id: 0, username: "TheMysticle", githubId: "TheMysticle", sponsorUrl: "", displayName: "TheMysticle", bio: "" };

interface GithubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GithubRelease {
    tag_name: string;
    assets: GithubReleaseAsset[];
}

/**
 * Resolves the download URL + version of a GitHub repo's latest release. By default picks the
 * release's first .zip asset (single-artifact repos); pass `assetName` to pick a specific asset
 * by exact filename instead, for repos (like Heck, which also hosts NoodleExtensions and Chroma)
 * whose latest release carries more than one mod's .zip.
 */
async function getLatestGithubRelease(owner: string, repo: string, assetName?: string): Promise<{ version: string; downloadUrl: string }> {
    const { data } = await RequestService.getInstance().getJSON<GithubRelease>(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    const asset = assetName ? data.assets?.find(a => a.name === assetName) : data.assets?.find(a => a.name.endsWith(".zip"));
    if (!asset) {
        throw new Error(`No matching .zip asset (${assetName ?? "any"}) in latest release of ${owner}/${repo}`);
    }
    return { version: data.tag_name.replace(/^v/, ""), downloadUrl: asset.browser_download_url };
}

/**
 * Downloads a mod's zip and md5-hashes each file inside, in the {path, hash} shape BeatMods
 * itself publishes as contentHashes.
 *
 * BsModsManagerService.getInstalledMods detects "is this mod installed" by md5-hashing files
 * found in Plugins/Libs and looking that hash up against known content hashes -- first a local
 * cache built from contentHashes entries in this very list, then (on a miss) the real BeatMods
 * hashlookup API as a fallback. Every entry below used to publish contentHashes: [], so a local
 * hash never matched anything here, and since none of these forked/rebuilt DLLs exist on the
 * real BeatMods either, the fallback also always came up empty -- every mod in this list showed
 * as "not installed" regardless of whether it actually was. Populating this properly (matching
 * whatever's actually in the release right now, since the zip's contents can change between
 * releases) fixes detection for all of them, not just the one that happened to get noticed.
 */
async function computeContentHashes(downloadUrl: string): Promise<BbmContentHash[]> {
    try {
        const buffer = await lastValueFrom(RequestService.getInstance().downloadBuffer(downloadUrl)).then(progress => progress.data);
        const zip = await BsmZipExtractor.fromBuffer(buffer);
        try {
            const hashes: BbmContentHash[] = [];
            for await (const entry of zip.entries()) {
                if (entry.fileName.endsWith("/")) {
                    continue;
                }
                const data = await entry.read();
                hashes.push({ path: entry.fileName, hash: crypto.createHash("md5").update(data).digest("hex") });
            }
            return hashes;
        } finally {
            zip.close();
        }
    } catch (error) {
        log.warn(`[experimental-1451-mods] Could not compute content hashes for ${downloadUrl}`, error);
        return [];
    }
}

function fullMod(params: {
    id: number;
    name: string;
    summary: string;
    category: BbmCategories;
    gitUrl: string;
    downloadUrl: string;
    modVersion: string;
    dependencies?: number[];
    contentHashes?: BbmContentHash[];
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
            contentHashes: params.contentHashes ?? [],
            supportedGameVersions: [{ id: 0, gameName: "BeatSaber", version: "1.45.1", defaultVersion: false }],
            downloadCount: 0,
        },
    };
}

/**
 * Same as fullMod(), but resolves downloadUrl/modVersion from `owner/repo`'s latest GitHub
 * release instead of taking them as fixed params. Falls back to `fallbackVersion`/
 * `fallbackDownloadUrl` (the last-known-good values) if that lookup fails for any reason.
 */
async function fullModFromLatestRelease(params: {
    id: number;
    name: string;
    summary: string;
    category: BbmCategories;
    gitUrl: string;
    owner: string;
    repo: string;
    /**
     * Exact release asset filename to pick, for repos whose latest release carries more than
     * one mod's .zip (Heck's release also has NoodleExtensions.zip and Chroma.zip). When set,
     * the release tag can't be trusted as *this* mod's version (it names all of them at once),
     * so the displayed modVersion always stays fallbackVersion -- only downloadUrl is resolved
     * dynamically. Update fallbackVersion by hand on new releases for these repos.
     */
    assetName?: string;
    fallbackVersion: string;
    fallbackDownloadUrl: string;
    dependencies?: number[];
}): Promise<BbmFullMod> {
    let modVersion = params.fallbackVersion;
    let downloadUrl = params.fallbackDownloadUrl;

    try {
        const latest = await getLatestGithubRelease(params.owner, params.repo, params.assetName);
        modVersion = params.assetName ? params.fallbackVersion : latest.version;
        downloadUrl = latest.downloadUrl;
    } catch (error) {
        log.warn(`[experimental-1451-mods] Could not resolve latest release for ${params.owner}/${params.repo}, using fallback ${params.fallbackVersion}`, error);
    }

    const contentHashes = await computeContentHashes(downloadUrl);

    return fullMod({
        id: params.id,
        name: params.name,
        summary: params.summary,
        category: params.category,
        gitUrl: params.gitUrl,
        downloadUrl,
        modVersion,
        dependencies: params.dependencies,
        contentHashes,
    });
}

export async function getExperimental1451Mods(): Promise<BbmFullMod[]> {
    const [
        siraUtil,
        bsml,
        songCore,
        iniParser,
        bsUtils,
        beatSaverSharp,
        beatSaverDownloader,
        beatSaverUpdater,
        whyIsThereNoLeaderboard,
        customJsonData,
        heck,
        noodleExtensions,
        chroma,
        leaderboardCore,
        scoreSaber,
    ] = await Promise.all([
        fullModFromLatestRelease({
            id: SIRAUTIL_ID,
            name: "SiraUtil",
            summary: "[Experimental 1.45.1 port] A powerful utility mod which provides more tools to Beat Saber modders.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/experimental-beatsaber-mods/SiraUtil",
            owner: "experimental-beatsaber-mods",
            repo: "SiraUtil",
            fallbackVersion: "3.4.0-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/SiraUtil/releases/download/v3.4.0-bs1.45.1/SiraUtil-3.4.0-bs1.45.1.zip",
            dependencies: [BSIPA_ID],
        }),
        fullModFromLatestRelease({
            id: BSML_ID,
            name: "BeatSaberMarkupLanguage",
            summary: "[Experimental 1.45.1 port] An XML-based UI system.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/experimental-beatsaber-mods/BeatSaberMarkupLanguage",
            owner: "experimental-beatsaber-mods",
            repo: "BeatSaberMarkupLanguage",
            fallbackVersion: "1.14.2-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/BeatSaberMarkupLanguage/releases/download/v1.14.2-bs1.45.1/BSML-1.14.2-bs1.45.1.zip",
            dependencies: [BSIPA_ID],
        }),
        fullModFromLatestRelease({
            id: SONGCORE_ID,
            name: "SongCore",
            summary: "[Experimental 1.45.1 port] A plugin for handling custom song additions in Beat Saber.",
            category: BbmCategories.Core,
            gitUrl: "https://github.com/experimental-beatsaber-mods/SongCore",
            owner: "experimental-beatsaber-mods",
            repo: "SongCore",
            fallbackVersion: "3.15.3-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/SongCore/releases/download/v3.15.3-bs1.45.1/SongCore-3.15.3-bs1.45.1.zip",
            dependencies: [BSIPA_ID, SIRAUTIL_ID, BSML_ID],
        }),
        fullModFromLatestRelease({
            id: INIPARSER_ID,
            name: "Ini Parser",
            summary: "[Experimental 1.45.1 port] .NET library for reading/writing INI data. Redistributed at the exact assembly identity (INIFileParser, Version=2.5.2.0) BS_Utils's IniFile utility references -- BeatMods' current listing ships a newer, renamed build (assembly INIParser 2.5.9.0) that does NOT satisfy that reference and causes a TypeLoadException at plugin startup.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/rickyah/ini-parser",
            owner: "experimental-beatsaber-mods",
            repo: "beatsaber-experimental-libs",
            fallbackVersion: "2.5.2.0",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/beatsaber-experimental-libs/releases/download/v2.5.2.0/INIFileParser-2.5.2.0.zip",
        }),
        fullModFromLatestRelease({
            id: BSUTILS_ID,
            name: "BS Utils",
            summary: "[Experimental 1.45.1 port] A basic library for beat saber mods to use.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/experimental-beatsaber-mods/Beat-Saber-Utils",
            owner: "experimental-beatsaber-mods",
            repo: "Beat-Saber-Utils",
            fallbackVersion: "1.14.4-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/Beat-Saber-Utils/releases/download/v1.14.4-bs1.45.1/BS_Utils-1.14.4-bs1.45.1-077404b.zip",
            dependencies: [BSIPA_ID, INIPARSER_ID],
        }),
        fullModFromLatestRelease({
            id: BEATSAVERSHARP_ID,
            name: "BeatSaverSharp",
            summary: "[Experimental 1.45.1 port] A .NET library for interacting with the BeatSaver API. Unmodified upstream (Auros/BeatSaverSharper, Unity build) -- doesn't reference any game assemblies directly.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/experimental-beatsaber-mods/BeatSaverSharper",
            owner: "experimental-beatsaber-mods",
            repo: "BeatSaverSharper",
            fallbackVersion: "3.4.5-unity",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/BeatSaverSharper/releases/download/v3.4.5-unity/BeatSaverSharp-3.4.5-Unity.zip",
        }),
        fullModFromLatestRelease({
            id: BEATSAVERDOWNLOADER_ID,
            name: "BeatSaverDownloader",
            summary: "[Experimental 1.45.1 port] Enables you to download songs from BeatSaver in-game.",
            category: BbmCategories.Core,
            gitUrl: "https://github.com/experimental-beatsaber-mods/BeatSaverDownloader",
            owner: "experimental-beatsaber-mods",
            repo: "BeatSaverDownloader",
            fallbackVersion: "6.0.7-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/BeatSaverDownloader/releases/download/v6.0.7-bs1.45.1/BeatSaverDownloader-6.0.7-bs1.45.1-03f6fb3.zip",
            dependencies: [BSIPA_ID, BSUTILS_ID, BSML_ID, SONGCORE_ID, BEATSAVERSHARP_ID, SCORESABERSHARP_ID],
        }),
        fullModFromLatestRelease({
            id: BEATSAVERUPDATER_ID,
            name: "BeatSaverUpdater",
            summary: "[Experimental 1.45.1 port] Alerts you of updates to maps and updates them to the latest version.",
            category: BbmCategories.Core,
            gitUrl: "https://github.com/experimental-beatsaber-mods/BeatSaverUpdater",
            owner: "experimental-beatsaber-mods",
            repo: "BeatSaverUpdater",
            fallbackVersion: "1.2.14-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/BeatSaverUpdater/releases/download/v1.2.14-bs1.45.1/BeatSaverUpdater-1.2.14-bs1.45.1-a9b14c1.zip",
            dependencies: [BSIPA_ID, BSML_ID, SONGCORE_ID, SIRAUTIL_ID, BEATSAVERSHARP_ID],
        }),
        fullModFromLatestRelease({
            id: WHYISTHERENOLEADERBOARD_ID,
            name: "WhyIsThereNoLeaderboard",
            summary: "[Experimental 1.45.1 port] Clarifies why leaderboards on custom songs are not supported and lets you download one.",
            category: BbmCategories.Essential,
            gitUrl: "https://github.com/experimental-beatsaber-mods/WhyIsThereNoLeaderboard",
            owner: "experimental-beatsaber-mods",
            repo: "WhyIsThereNoLeaderboard",
            fallbackVersion: "1.0.3-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/WhyIsThereNoLeaderboard/releases/download/v1.0.3-bs1.45.1/WhyIsThereNoLeaderboard-1.0.3-bs1.45.1-ce72195.zip",
            dependencies: [BSIPA_ID, BSML_ID, SIRAUTIL_ID],
        }),
        fullModFromLatestRelease({
            id: CUSTOMJSONDATA_ID,
            name: "CustomJSONData",
            summary: "[Experimental 1.45.1 port] Lets mappers include arbitrary data in beatmaps, and lets modders access that data. Required by Heck/Noodle Extensions/Chroma. Confirmed working with real V2/V3-format maps on real hardware; V4 beatmap-format custom data support is new and not yet verified against real gameplay.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/experimental-beatsaber-mods/CustomJSONData",
            owner: "experimental-beatsaber-mods",
            repo: "CustomJSONData",
            fallbackVersion: "2.6.8-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/CustomJSONData/releases/download/v2.6.8-bs1.45.1/CustomJSONData.zip",
            dependencies: [BSIPA_ID],
        }),
        fullModFromLatestRelease({
            id: HECK_ID,
            name: "Heck",
            summary: "[Experimental 1.45.1 port] Shared framework library for Noodle Extensions and Chroma.",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/experimental-beatsaber-mods/Heck",
            owner: "experimental-beatsaber-mods",
            repo: "Heck",
            assetName: "Heck.zip",
            fallbackVersion: "1.8.3-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/Heck/releases/download/v1.8.3-1.7.21-2.9.22-bs1.45.1/Heck.zip",
            dependencies: [BSIPA_ID, BSML_ID, SIRAUTIL_ID, CUSTOMJSONDATA_ID],
        }),
        fullModFromLatestRelease({
            id: NOODLEEXTENSIONS_ID,
            name: "Noodle Extensions",
            summary: "[Experimental 1.45.1 port] Custom note/environment/player animation for mappers.",
            category: BbmCategories.Gameplay,
            gitUrl: "https://github.com/experimental-beatsaber-mods/Heck",
            owner: "experimental-beatsaber-mods",
            repo: "Heck",
            assetName: "NoodleExtensions.zip",
            fallbackVersion: "1.7.21-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/Heck/releases/download/v1.8.3-1.7.21-2.9.22-bs1.45.1/NoodleExtensions.zip",
            dependencies: [BSIPA_ID, SIRAUTIL_ID, CUSTOMJSONDATA_ID, HECK_ID],
        }),
        fullModFromLatestRelease({
            id: CHROMA_ID,
            name: "Chroma",
            summary: "[Experimental 1.45.1 port] Color/lighting extensions for mappers. Its light-registration internals were reworked for 1.45.1; confirmed working (colored lighting on real maps, no crashes) across an extended real-hardware session.",
            category: BbmCategories.Lighting,
            gitUrl: "https://github.com/experimental-beatsaber-mods/Heck",
            owner: "experimental-beatsaber-mods",
            repo: "Heck",
            assetName: "Chroma.zip",
            fallbackVersion: "2.9.22-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/Heck/releases/download/v1.8.3-1.7.21-2.9.22-bs1.45.1/Chroma.zip",
            dependencies: [BSIPA_ID, BSML_ID, SIRAUTIL_ID, CUSTOMJSONDATA_ID, HECK_ID],
        }),
        fullModFromLatestRelease({
            id: LEADERBOARDCORE_ID,
            name: "LeaderboardCore",
            summary: "[Experimental 1.45.1 port] Shared library for custom leaderboards (used by ScoreSaber's leaderboard UI).",
            category: BbmCategories.Library,
            gitUrl: "https://github.com/experimental-beatsaber-mods/LeaderboardCore",
            owner: "experimental-beatsaber-mods",
            repo: "LeaderboardCore",
            fallbackVersion: "1.6.0-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/LeaderboardCore/releases/download/v1.6.0-bs1.45.1/LeaderboardCore.zip",
            dependencies: [BSIPA_ID, BSML_ID, SIRAUTIL_ID],
        }),
        fullModFromLatestRelease({
            id: SCORESABER_ID,
            name: "ScoreSaber",
            summary: "[Experimental 1.45.1 port] Online leaderboard for custom songs. VIEWING ONLY on this build -- no dev token has been requested, so score upload is expected to be refused by the client itself (see the fork's README for why that's the correct behavior, not a bug). Also requires a paired Legato compatibility-library port, not distributed separately since it compiles directly into this plugin.",
            category: BbmCategories.Essential,
            gitUrl: "https://github.com/experimental-beatsaber-mods/pc-mod",
            owner: "experimental-beatsaber-mods",
            repo: "pc-mod",
            fallbackVersion: "3.4.2-bs1.45.1",
            fallbackDownloadUrl: "https://github.com/experimental-beatsaber-mods/pc-mod/releases/download/v3.4.2-bs1.45.1/ScoreSaber.zip",
            dependencies: [BSIPA_ID, BSML_ID, SIRAUTIL_ID, SONGCORE_ID, LEADERBOARDCORE_ID],
        }),
    ]);

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
        siraUtil,
        bsml,
        songCore,
        iniParser,
        fullMod({
            id: SCORESABERSHARP_ID,
            name: "ScoreSaberSharp",
            summary: "[Experimental 1.45.1 port] Official C# library for the ScoreSaber API. Unmodified -- pulled straight from BeatMods' own CDN (byte-identical), since it's closed-source and version-agnostic.",
            category: BbmCategories.Library,
            gitUrl: "https://scoresaber.com",
            downloadUrl: "https://beatmods.com/cdn/mod/8713168c598577ee7c73fa3cf0e26f5c.zip",
            modVersion: "0.1.0",
        }),
        bsUtils,
        beatSaverSharp,
        beatSaverDownloader,
        beatSaverUpdater,
        whyIsThereNoLeaderboard,
        customJsonData,
        heck,
        noodleExtensions,
        chroma,
        leaderboardCore,
        scoreSaber,
    ];
}
