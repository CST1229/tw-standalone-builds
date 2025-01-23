/*
	EXTREMELY messy script to bundle TurboWarp and all of its assets into a single HTML file.

	Arguments (all optional):
	--output [path] - set the output file. defaults to tw-standalone[-offline-extensions].html
	--guiPath [path] - set the path to the GUI. defaults to scratch-gui/build
	--extensions [path?] - enable inlining extensions, with an optional path. defaults to extensions/build if path not set
	--debug - outputs inlined assets to a folder
*/

import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {argv} from "node:process";

// If true, builds with an integrated extensions.turbowarp.org mirror.
// Not implemented yet.
const withExtensions = argv.includes("--extensions");
// Write processed (inlinable) assets back into a folder.
const debugAssets = argv.includes("--debug");

// Path to get GUI build from.
let guiPath = "scratch-gui/build/";
// Path to get built extensions from.
let extensionsPath = "extensions/build/";
// Output file.
let output = "tw-standalone" + (withExtensions ? "-offline-extensions" : "") + ".html";

argv.forEach((val, index) => {
	if (val === "--guiPath") {
		guiPath = argv[index + 1];
	} else if (val === "--output") {
		output = argv[index + 1];
	} else if (val === "--extensions") {
		const newPath = argv[index + 1];
		if (newPath && !newPath.startsWith("--"))
			extensionsPath = newPath;
	}
});

const extsTwOrg = "https://extensions.turbowarp.org/";

const inlinedRegexes = [
	String.raw`js/pentapod/\w.+?\.js`,
	String.raw`js/extension-worker/.+?\.js`,
	String.raw`static/assets/.+?\.\w+`,
	String.raw`privacy.html`,
	String.raw`credits.html`,
];
const inlinedRawRegexes = [
	// scratch-blocks assets
	String.raw`\w+\.mainWorkspace\.options\.pathToMedia\+".+?"`,
	// extension thumbnails
	withExtensions && String.raw`"https://extensions.turbowarp.org/"\.concat\(\w+\.image\|\|"images/unknown.svg"\)`
];
const convertRegex = new RegExp(`(["'])(${inlinedRegexes.map(o => !o ? "" : "(?:" + o + ")").join("|")})\\1`, "gi");
const convertRawRegex = new RegExp(`(${inlinedRawRegexes.map(o => !o ? "" : "(?:" + o + ")").join("|")})`, "gi");
function inlineFile(path) {
	const contents = fsSync.readFileSync(path, {encoding: "utf8"});
	return contents
		.replaceAll(convertRegex,
			(string, quote, url) => inlineBlobUrl(quote+url+quote)
		)
		.replaceAll(convertRawRegex, (string, url) => inlineBlobUrl(url));
}
function inlineBlobUrl(path) {
	if (path === '"credits.html"') {
		return `(location.pathname+"?credits")`;
	} else if (path === '"privacy.html"') {
		return `(location.pathname+"?privacy-policy")`;
	}
	return `$url(${path})`;
}


// Every asset path and its corresponding base85 (or data url)
const cache = {};
const lengthCache = {};
// Store small assets and SVGs as data URLs. For SVGs, they *have* to be data URLs due to MIME type stuff
const assetIsDataUrl = {};

const rootFile = guiPath + "editor.html";
function generateBlobCode(html) {
	const blobCode = `{
	// Generated code to make everything work in a single file
	// Creates blob: URLs for every other file and puts them in an object for further retrieval
	
	// Base85 decoder originally from the TurboWarp Packager:
	// https://github.com/TurboWarp/packager/blob/master/src/packager/base85.js
	const getBase85DecodeValue = (code) => {
		if (code === 0x28) code = 0x3c;
		if (code === 0x29) code = 0x3e;
		return code - 0x2a;
	};
	const base85Decode = (str, actualLength = -1) => {
		const byteLength = Math.floor(str.length / 5 * 4);
		if (actualLength === -1) actualLength = byteLength;
		const outBuffer = new ArrayBuffer(byteLength);
		const view = new DataView(outBuffer, 0, byteLength);
		for (let i = 0, j = 0; i < str.length; i += 5, j += 4) {
			view.setUint32(j, (
				getBase85DecodeValue(str.charCodeAt(i + 4)) * 85 * 85 * 85 * 85 +
				getBase85DecodeValue(str.charCodeAt(i + 3)) * 85 * 85 * 85 +
				getBase85DecodeValue(str.charCodeAt(i + 2)) * 85 * 85 +
				getBase85DecodeValue(str.charCodeAt(i + 1)) * 85 +
				getBase85DecodeValue(str.charCodeAt(i))
			), true);
		}
		
		return outBuffer.transferToFixedLength(actualLength);
	};
	
	window.___BLOB_URLS = Object.create(null);
	Object.assign(window.___BLOB_URLS,{${
		Object.keys(cache).map(
			url => '"' + url + '":' + (
				assetIsDataUrl[url] ? 
				(JSON.stringify(cache[url])) :
				('URL.createObjectURL(new Blob([base85Decode('+JSON.stringify(cache[url])+','+lengthCache[url]+')]))')
			)
		).join(",")
	}});
	
	window.___GET_BLOB_URL = function(url) {
		if (url in window.___BLOB_URLS) return window.___BLOB_URLS[url];
		throw new Error("Couldn't get blob url: " + url);
	};
	// shorthand to decrease filesize
	window.$url = window.___GET_BLOB_URL;
	
	// Patch a bunch of functions
	
	// Patch window.open to open the inlined addon settings through query params
	const oldWindowOpen = window.open;
	window.open = function(...args) {
		if (args[0] === "addons.html") args[0] = location.pathname + "?addon-settings"
		return oldWindowOpen.apply(this, args);
	};${!withExtensions ? "" : `
	const oldFetch = fetch;
	window.fetch = function(...args) {
		if (args[0] && args[0] in window.___BLOB_URLS)
			return oldFetch.apply(this, [window.___BLOB_URLS[args[0]], ...args.slice(1)]);
		return oldFetch.apply(this, args);
	};
	// Redirect extensions.turbowarp.org script tags (unsandboxed extensions) to our inlined files
	const oldAppendChild = document.body.appendChild;
	document.body.appendChild = function(...args) {
		const firstArg = args[0];
		if (firstArg && firstArg.tagName === "SCRIPT" && firstArg.src in window.___BLOB_URLS)
			firstArg.src = window.___BLOB_URLS[firstArg.src];
		return oldAppendChild.apply(this, args);
	}`}
}`;
	return html.replace(`<div id="app"></div>`, `<div id="app"></div>
<script>document.querySelector(".splash-screen").textContent="Loading assets...";</script>
<script>${blobCode}</script>
<script>document.querySelector(".splash-screen").textContent="";</script>`);
}

let addonSettingsEntrypoint = "";
let creditsEntrypoint = "";
function isEntrypoint(path) {
	return path.startsWith("js/pentapod/addon-settings.") ||
		path.startsWith("js/pentapod/editor.") ||
		path.startsWith("js/pentapod/fullscreen.") ||
		path.startsWith("js/pentapod/embed.") ||
		path.startsWith("js/pentapod/credits.");
}
function isCommonModule(path) {
	if (isEntrypoint(path)) {
		if (path.startsWith("js/pentapod/addon-settings.") && path.endsWith(".js")) addonSettingsEntrypoint = path;
		if (path.startsWith("js/pentapod/credits.") && path.endsWith(".js")) creditsEntrypoint = path;
		return true;
	}
	return path.endsWith(".js") && path.startsWith("js/pentapod") && path.includes("~");
}

// Patch the generated JS to load modules from the blobs instead of files
function fixModuleScript(js) {
	return js.replace(
		/(.\.src=)(function\(.\){return .\..\+"js\/pentapod\/"\+.+?\}\[.\]\+"\.js"\}\(.\))/,
		(string, g1, g2) => (g1 + inlineBlobUrl(g2))
	);
}
function inlineScriptTags(file) {
	const scriptTagRegex = /<script src="(.+?)">/gi;
	return file.replaceAll(scriptTagRegex, (string, src) => {
		let script;
		if (addonSettingsEntrypoint && src.startsWith("js/pentapod/editor")) {
			const privacyHTML = fsSync.readFileSync(guiPath + "privacy.html", {encoding: "utf8"});
			script = `if (location.search.includes("?addon-settings") || location.search.includes("&addon-settings")) {${
				fixModuleScript(inlineFile(path.resolve(guiPath, addonSettingsEntrypoint)))
			}} else if (location.search.includes("?credits") || location.search.includes("&credits")) {${
				fixModuleScript(inlineFile(path.resolve(guiPath, creditsEntrypoint)))
			}} else if (location.search.includes("?privacy-policy") || location.search.includes("&privacy-policy")) {
				window.onload = () => document.documentElement.innerHTML = ${JSON.stringify(privacyHTML)};
			}else {${
				fixModuleScript(inlineFile(path.resolve(guiPath, src)))}
			}`
		} else {
			script = fixModuleScript(inlineFile(path.resolve(guiPath, src)));
		}
		return `<script>${script}`
	});
}


// Base85 encoder originally from the TurboWarp Packager:
// https://github.com/TurboWarp/packager/blob/master/src/packager/base85.js
const getBase85EncodeCharacter = (n) => {
  n += 0x2a;
  if (n === 0x3c) return 0x28;
  if (n === 0x3e) return 0x29;
  return n;
};
const base85Encode = (uint8) => {
	const originalLength = uint8.length;
	
	// Data length needs to be a multiple of 4 so we can use getUint32.
	// If it's not, we'll have to make a copy and pad with zeros.
	let dataView;
	if (originalLength % 4 !== 0) {
		const newUint8 = new Uint8Array(Math.ceil(originalLength / 4) * 4);
		for (let i = 0; i < originalLength; i++) {
			newUint8[i] = uint8[i];
		}
		dataView = new DataView(newUint8.buffer);
	} else {
		dataView = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
	}
	
	// Pre-allocating buffer and using TextDecoder at the end is faster than string concatenation
	// Each set of 4 bytes is represented by 5 characters. Pad with zeros if needed.
	const result = new Uint8Array(Math.ceil(originalLength / 4) * 5);
	let resultIndex = 0;
	
	for (let i = 0; i < dataView.byteLength; i += 4) {
		let n = dataView.getUint32(i, true);
		result[resultIndex++] = getBase85EncodeCharacter(n % 85);
		n = Math.floor(n / 85);
		result[resultIndex++] = getBase85EncodeCharacter(n % 85);
		n = Math.floor(n / 85);
		result[resultIndex++] = getBase85EncodeCharacter(n % 85);
		n = Math.floor(n / 85);
		result[resultIndex++] = getBase85EncodeCharacter(n % 85);
		n = Math.floor(n / 85);
		result[resultIndex++] = getBase85EncodeCharacter(n % 85);
	}
	
	return new TextDecoder().decode(result);
};

function getMime(path) {
	if (path.endsWith(".svg")) return "image/svg+xml";
	if (path.endsWith(".png")) return "image/png";
	if (path.endsWith(".bmp")) return "image/bmp";
	if (path.endsWith(".gif")) return "image/gif";
	if (path.endsWith(".webp")) return "image/webp";
	if (path.endsWith(".jpeg")) return "image/jpeg";
	if (path.endsWith(".jpg")) return "image/jpeg";
	if (path.endsWith(".ico")) return "image/ico";
	if (path.endsWith(".js")) return "application/javascript";
	if (path.endsWith(".css")) return "text/css";
	if (path.endsWith(".json")) return "application/json";
	if (path.endsWith(".zip")) return "application/zip";
	if (path.endsWith(".sb3")) return "application/zip";
	if (path.endsWith(".wav")) return "audio/wav";
	if (path.endsWith(".mp3")) return "audio/mpeg";
	if (path.endsWith(".webm")) return "audio/webm";
	if (path.endsWith(".ogg")) return "audio/ogg";
	if (path.endsWith(".html")) return "text/html";
	if (path.endsWith(".woff")) return "font/woff";
	if (path.endsWith(".woff2")) return "font/woff2";
	if (path.endsWith(".ttf")) return "font/ttf";
	if (path.endsWith(".txt")) return "text/plain";
	return "application/octet-stream";
}
function toDataUrl(buffer, path = "") {
	return "data:" + getMime(path) + ";base64," + buffer.toString("base64");
}


const MIN_BLOBURL_LENGTH = 4096;

async function parseAsset(file, asFile = file) {
	let buffer;
	if (file.endsWith(".js")) {
		buffer = Buffer.from(inlineFile(file));
	} else {
		buffer = await fs.readFile(file);
	}
	if (debugAssets) {
		const realPath = asFile.replaceAll("https://", "");
		fs.mkdir("standalone_assets/" + realPath.split("/").slice(0,-1).join("/"), {recursive: true})
			.then(() => fs.writeFile("standalone_assets/" + realPath, buffer));
	}
	
	lengthCache[asFile] = buffer.length;
	assetIsDataUrl[asFile] = (lengthCache[asFile] < MIN_BLOBURL_LENGTH) || file.endsWith(".svg");
	if (!assetIsDataUrl[asFile]) {
		const arr = new Uint8Array(buffer);
		cache[asFile] = base85Encode(arr);
	} else {
		cache[asFile] = toDataUrl(buffer, asFile);
	}
	console.log("Added to assets:", file, "as", asFile);
}

if (debugAssets) await fs.mkdir("standalone_assets/", {recursive: true});

console.log("Adding assets...");
const promises = [];
{
	const files = await fs.readdir(guiPath, {recursive: true});
	for (let file of files) {
		file = file.replaceAll("\\", "/");
		if (
			file.endsWith(".bat") || file.endsWith(".mjs") || file.endsWith(".html") ||
			isCommonModule(file) || !file.includes(".")
		) continue;
		promises.push(parseAsset(guiPath + file, file));
	}
}
if (withExtensions) {
	const files = await fs.readdir(extensionsPath, {recursive: true});
	for (let file of files) {
		file = file.replaceAll("\\", "/");
		if (
			(!file.endsWith(".js") && !file.endsWith(".json") && !file.startsWith("images/")) || !file.includes(".")
			|| file.startsWith("test/") || file.startsWith("docs-examples/") || file.startsWith("docs-internal/")
		) continue;
		promises.push(parseAsset(extensionsPath + file, extsTwOrg + file));
	}
}
await Promise.all(promises);

console.log("Generating final file...");
const outputCode = generateBlobCode(inlineScriptTags(await fs.readFile(rootFile, {encoding: "utf8"})));
console.log("Writing:", output);
await fs.writeFile(output, outputCode);
console.log(`Done! (filesize: ${outputCode.length / 1000000}MB)`);
