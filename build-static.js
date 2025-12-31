const fs = require("fs");
const path = require("path");

// Import content loaders from server.js
const CONTENT_DIR = path.join(__dirname, "content");

// ============================================================================
// CONTENT PARSERS (same as server.js)
// ============================================================================

function parseFrontmatter(content) {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
        return { data: {}, content: content };
    }

    const yamlContent = match[1];
    const markdownContent = match[2];

    const data = parseSimpleYaml(yamlContent);

    return { data, content: markdownContent };
}

function parseSimpleYaml(yaml) {
    const lines = yaml.split(/\r?\n/);

    function getIndent(line) {
        const match = line.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }

    function parseValue(value) {
        if (!value || value === "") return null;
        value = value.trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            return value.slice(1, -1);
        }

        if (value === "true") return true;
        if (value === "false") return false;

        if (!isNaN(value) && value !== "") {
            return Number(value);
        }

        return value;
    }

    function parseBlock(startIdx, baseIndent) {
        const result = {};
        let i = startIdx;

        while (i < lines.length) {
            const line = lines[i];

            if (!line.trim() || line.trim().startsWith("#")) {
                i++;
                continue;
            }

            const currentIndent = getIndent(line);

            if (currentIndent < baseIndent) {
                break;
            }

            if (currentIndent === baseIndent) {
                const trimmedLine = line.trim();

                if (trimmedLine.startsWith("- ")) {
                    i++;
                    continue;
                }

                if (trimmedLine.includes(":")) {
                    const colonIdx = trimmedLine.indexOf(":");
                    const key = trimmedLine.substring(0, colonIdx).trim();
                    const valueStr = trimmedLine.substring(colonIdx + 1).trim();

                    if (valueStr === "" || valueStr === "|" || valueStr === ">") {
                        const nextLineIdx = i + 1;
                        if (nextLineIdx < lines.length) {
                            const nextLine = lines[nextLineIdx];
                            const nextTrimmed = nextLine.trim();
                            const nextIndent = getIndent(nextLine);

                            if (nextTrimmed.startsWith("- ")) {
                                const arrayResult = parseArray(nextLineIdx, nextIndent);
                                result[key] = arrayResult.value;
                                i = arrayResult.endIdx;
                                continue;
                            } else if (
                                nextIndent > currentIndent &&
                                nextTrimmed.includes(":")
                            ) {
                                const objResult = parseBlock(nextLineIdx, nextIndent);
                                result[key] = objResult.value;
                                i = objResult.endIdx;
                                continue;
                            }
                        }
                        result[key] = "";
                    } else {
                        result[key] = parseValue(valueStr);
                    }
                }
            }

            i++;
        }

        return { value: result, endIdx: i };
    }

    function parseArray(startIdx, baseIndent) {
        const result = [];
        let i = startIdx;

        while (i < lines.length) {
            const line = lines[i];

            if (!line.trim() || line.trim().startsWith("#")) {
                i++;
                continue;
            }

            const currentIndent = getIndent(line);

            if (currentIndent < baseIndent) {
                break;
            }

            const trimmedLine = line.trim();

            if (currentIndent === baseIndent && trimmedLine.startsWith("- ")) {
                const afterDash = trimmedLine.substring(2).trim();

                if (afterDash.includes(":")) {
                    const colonIdx = afterDash.indexOf(":");
                    const key = afterDash.substring(0, colonIdx).trim();
                    const valueStr = afterDash.substring(colonIdx + 1).trim();

                    const obj = {};
                    obj[key] = parseValue(valueStr);

                    let j = i + 1;
                    const objectIndent = currentIndent + 2;

                    while (j < lines.length) {
                        const propLine = lines[j];
                        if (!propLine.trim() || propLine.trim().startsWith("#")) {
                            j++;
                            continue;
                        }

                        const propIndent = getIndent(propLine);
                        const propTrimmed = propLine.trim();

                        if (
                            propIndent >= objectIndent &&
                            propTrimmed.includes(":") &&
                            !propTrimmed.startsWith("-")
                        ) {
                            const propColonIdx = propTrimmed.indexOf(":");
                            const propKey = propTrimmed.substring(0, propColonIdx).trim();
                            const propValue = propTrimmed.substring(propColonIdx + 1).trim();
                            obj[propKey] = parseValue(propValue);
                            j++;
                        } else {
                            break;
                        }
                    }

                    result.push(obj);
                    i = j;
                    continue;
                } else if (afterDash) {
                    result.push(parseValue(afterDash));
                }
            }

            i++;
        }

        return { value: result, endIdx: i };
    }

    let baseIndent = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() && !line.trim().startsWith("#")) {
            baseIndent = getIndent(line);
            break;
        }
    }

    const parseResult = parseBlock(0, baseIndent);
    return parseResult.value;
}

function parseBibtex(content) {
    const publications = [];
    const entryRegex = /@(\w+)\s*\{([^,]+),\s*([\s\S]*?)\n\}/g;

    let match;
    while ((match = entryRegex.exec(content)) !== null) {
        const entryType = match[1];
        const key = match[2];
        const fieldsStr = match[3];

        const entry = { key, entryType };

        const fieldRegex = /(\w+)\s*=\s*\{([^}]*)\}/g;
        let fieldMatch;
        while ((fieldMatch = fieldRegex.exec(fieldsStr)) !== null) {
            entry[fieldMatch[1].toLowerCase()] = fieldMatch[2].trim();
        }

        if (entry.author) {
            entry.authors = entry.author.replace(/ and /g, ", ");
        }

        publications.push({
            title: entry.title || "",
            authors: entry.authors || entry.author || "",
            year: entry.year || "",
            type:
                entry.type ||
                (entryType === "inproceedings" ? "Conference" : "Journal"),
            source: entry.journal || entry.booktitle || "",
            doi: entry.doi || null,
            citations: entry.citations ? parseInt(entry.citations) : 0,
        });
    }

    return publications;
}

function markdownToHtml(markdown) {
    if (!markdown) return "";

    return markdown
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>")
        .replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" class="text-teal-600 hover:text-teal-700 hover:underline font-medium">$1</a>'
        )
        .replace(/\n/g, "<br>")
        .trim();
}

// ============================================================================
// CONTENT LOADERS
// ============================================================================

function loadBio() {
    try {
        const filePath = path.join(CONTENT_DIR, "bio.md");
        const content = fs.readFileSync(filePath, "utf-8");
        const { data, content: markdown } = parseFrontmatter(content);

        return {
            ...data,
            bio_html: markdownToHtml(markdown),
        };
    } catch (error) {
        console.error("Error loading bio:", error);
        return {};
    }
}

function loadPositions() {
    try {
        const filePath = path.join(CONTENT_DIR, "positions.md");
        const content = fs.readFileSync(filePath, "utf-8");
        const { data } = parseFrontmatter(content);

        const positions = data.jabatan || [];
        return positions.map((pos) => ({
            ...pos,
            deskripsi: markdownToHtml(pos.deskripsi),
        }));
    } catch (error) {
        console.error("Error loading positions:", error);
        return [];
    }
}

function loadContact() {
    try {
        const filePath = path.join(CONTENT_DIR, "contact.md");
        const content = fs.readFileSync(filePath, "utf-8");
        const { data } = parseFrontmatter(content);

        return data;
    } catch (error) {
        console.error("Error loading contact:", error);
        return {};
    }
}

function loadPublications() {
    try {
        const filePath = path.join(CONTENT_DIR, "publications.bib");
        const content = fs.readFileSync(filePath, "utf-8");
        return parseBibtex(content);
    } catch (error) {
        console.error("Error loading publications:", error);
        return [];
    }
}

// ============================================================================
// BUILD STATIC HTML
// ============================================================================

function buildStaticSite() {
    console.log("🔨 Building static site...\n");

    // Load all content
    const bio = loadBio();
    const positions = loadPositions();
    const contact = loadContact();
    const publications = loadPublications();

    console.log("✅ Loaded bio data");
    console.log("✅ Loaded", positions.length, "positions");
    console.log("✅ Loaded", publications.length, "publications");
    console.log("✅ Loaded contact data\n");

    // Read the original HTML template
    const templatePath = path.join(__dirname, "public", "index.html");
    let html = fs.readFileSync(templatePath, "utf-8");

    // Extract the render functions from the original script
    const scriptContent = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const renderFunctionsStart = scriptContent.indexOf("// RENDER FUNCTIONS");

    let renderFunctionsCode = "";
    if (renderFunctionsStart !== -1) {
        renderFunctionsCode = scriptContent.substring(renderFunctionsStart);
    } else {
        console.error("⚠️ Could not find RENDER FUNCTIONS in script!");
    }

    // Create embedded data script
    const dataScript = `
    <script id="embedded-data">
      window.__SITE_DATA__ = ${JSON.stringify(
        {
            bio,
            positions,
            contact,
            publications,
        },
        null,
        2
    )};
    </script>
  `;

    // Create the new main script
    const newMainScript = `
    <script>
      // Load content from embedded data instead of API
      async function loadAllContent() {
        try {
          const data = window.__SITE_DATA__;
          console.log("Loading content from embedded data...", data);
          if (typeof renderBio === 'function') renderBio(data.bio);
          if (typeof renderPositions === 'function') renderPositions(data.positions);
          if (typeof renderPublications === 'function') renderPublications(data.publications);
          if (typeof renderContact === 'function') renderContact(data.contact);
        } catch (error) {
          console.error("Error loading content:", error);
        }
      }
      
      ${renderFunctionsCode}
      
      // Load content on page load
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadAllContent);
      } else {
        loadAllContent();
      }
    </script>
    `;

    // Replace the entire original script with our new scripts
    html = html.replace(
        /<script>[\s\S]*?<\/script>/,
        dataScript + "\n" + newMainScript
    );

    // Create docs directory if it doesn't exist
    const docsDir = path.join(__dirname, "docs");
    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir);
    }

    // Write the static HTML file
    const outputPath = path.join(docsDir, "index.html");
    fs.writeFileSync(outputPath, html);
    console.log("✅ Generated static HTML:", outputPath);

    // Copy profile picture
    const profileSrc = path.join(__dirname, "public", "profile_pic.png");
    const profileDest = path.join(docsDir, "profile_pic.png");
    if (fs.existsSync(profileSrc)) {
        fs.copyFileSync(profileSrc, profileDest);
        console.log("✅ Copied profile picture");
    }

    console.log("\n🎉 Static site built successfully!");
    console.log("📁 Output directory: docs/");
    console.log(
        "\n💡 Next steps:\n   1. Test locally by opening docs/index.html\n   2. Commit and push to GitHub\n   3. Enable GitHub Pages from 'docs' folder"
    );
}

// Run the build
buildStaticSite();
