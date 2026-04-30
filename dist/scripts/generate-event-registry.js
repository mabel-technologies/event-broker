import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { $log } from "@tsed/logger";
import ts from "typescript";
const PROJECT_ROOT = resolve(process.env.EVENT_BROKER_REGISTRY_ROOT ?? process.cwd());
const EVENT_NAME_RE = /^[.a-z0-9-]+$/;
function getServiceName() {
    const pkgPath = join(PROJECT_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.name ?? "unknown";
}
function unwrapExpression(expr) {
    let e = expr;
    for (;;) {
        if (ts.isParenthesizedExpression(e)) {
            e = e.expression;
            continue;
        }
        if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) {
            e = e.expression;
            continue;
        }
        break;
    }
    return e;
}
function skipAlias(checker, symbol) {
    return symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
}
function resolveStaticString(checker, cache, expr, depth = 0) {
    if (!expr || depth > 48)
        return null;
    const inner = unwrapExpression(expr);
    const cached = cache.get(inner);
    if (cached !== undefined)
        return cached;
    const finish = (v) => {
        cache.set(inner, v);
        return v;
    };
    if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
        return finish(inner.text);
    }
    // Fix: checker.getConstantValue overloads accept EnumMember vs prop/element access — assert after kind checks
    let constVal = undefined;
    if (ts.isEnumMember(inner) ||
        ts.isPropertyAccessExpression(inner) ||
        ts.isElementAccessExpression(inner)) {
        constVal = checker.getConstantValue(inner);
    }
    if (typeof constVal === "string") {
        return finish(constVal);
    }
    if (ts.isIdentifier(inner) ||
        ts.isPropertyAccessExpression(inner) ||
        ts.isElementAccessExpression(inner)) {
        const rawSym = checker.getSymbolAtLocation(inner);
        if (!rawSym) {
            return finish(null);
        }
        const symbol = skipAlias(checker, rawSym);
        const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
        if (!decl) {
            return finish(null);
        }
        if (ts.isVariableDeclaration(decl) && decl.initializer) {
            return finish(resolveStaticString(checker, cache, decl.initializer, depth + 1));
        }
        if (ts.isParameter(decl)) {
            return finish(null);
        }
        if (ts.isEnumMember(decl)) {
            if (decl.initializer) {
                return finish(resolveStaticString(checker, cache, decl.initializer, depth + 1));
            }
            return finish(null);
        }
        if (ts.isPropertyAssignment(decl)) {
            return finish(resolveStaticString(checker, cache, decl.initializer, depth + 1));
        }
        if (ts.isShorthandPropertyAssignment(decl)) {
            const shSym = checker.getShorthandAssignmentValueSymbol(decl);
            if (shSym) {
                const shDecl = shSym.valueDeclaration ?? shSym.declarations?.[0];
                if (shDecl && ts.isVariableDeclaration(shDecl) && shDecl.initializer) {
                    return finish(resolveStaticString(checker, cache, shDecl.initializer, depth + 1));
                }
            }
            return finish(null);
        }
        if (ts.isPropertyDeclaration(decl) && decl.initializer) {
            return finish(resolveStaticString(checker, cache, decl.initializer, depth + 1));
        }
        if (ts.isBindingElement(decl)) {
            return finish(null);
        }
        return finish(null);
    }
    return finish(null);
}
function isOnSubscribeCallee(expr) {
    return ts.isIdentifier(expr) && expr.text === "OnSubscribe";
}
function collectOnSubscribeEvents(sourceFile, checker, cache, out) {
    const visit = (node) => {
        if (ts.canHaveDecorators(node)) {
            for (const dec of ts.getDecorators(node) ?? []) {
                const call = dec.expression;
                if (!ts.isCallExpression(call) || !isOnSubscribeCallee(call.expression))
                    continue;
                const arg0 = call.arguments[0];
                if (!arg0)
                    continue;
                const name = resolveStaticString(checker, cache, arg0);
                if (name && EVENT_NAME_RE.test(name))
                    out.add(name);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
}
function collectPublishEvents(sourceFile, checker, cache, out) {
    const visit = (node) => {
        if (ts.isCallExpression(node)) {
            let callee = node.expression;
            callee = unwrapExpression(callee);
            if (ts.isPropertyAccessExpression(callee) &&
                callee.name.text === "publish") {
                const arg0 = node.arguments[0];
                if (arg0) {
                    const name = resolveStaticString(checker, cache, arg0);
                    if (name && EVENT_NAME_RE.test(name))
                        out.add(name);
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
}
function collectSourceFiles(rootDir) {
    const out = [];
    const walk = (dir) => {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, ent.name);
            if (ent.isDirectory()) {
                if (ent.name === "node_modules" ||
                    ent.name === "dist" ||
                    ent.name === "build" ||
                    ent.name.startsWith(".")) {
                    continue;
                }
                walk(full);
            }
            else if (/\.[cm]?tsx?$/.test(ent.name)) {
                out.push(full);
            }
        }
    };
    walk(rootDir);
    return out;
}
function createProgramFromProjectRoot() {
    const srcRoot = join(PROJECT_ROOT, "src");
    let rootNames;
    try {
        const st = readdirSync(srcRoot, { withFileTypes: true });
        if (st.length >= 0) {
            rootNames = collectSourceFiles(srcRoot);
        }
        else {
            rootNames = [];
        }
    }
    catch {
        rootNames = [];
    }
    if (rootNames.length === 0) {
        rootNames = collectSourceFiles(PROJECT_ROOT);
    }
    if (rootNames.length === 0) {
        throw new Error(`No .ts/.tsx files found under ${PROJECT_ROOT}. Set EVENT_BROKER_REGISTRY_ROOT or add sources (e.g. src/).`);
    }
    const options = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        noEmit: true,
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
    };
    return ts.createProgram({ rootNames, options });
}
function main() {
    const program = createProgramFromProjectRoot();
    const checker = program.getTypeChecker();
    const consumers = new Set();
    const producers = new Set();
    for (const sourceFile of program.getSourceFiles()) {
        if (sourceFile.isDeclarationFile)
            continue;
        if (sourceFile.fileName.includes("node_modules"))
            continue;
        const cache = new Map();
        collectOnSubscribeEvents(sourceFile, checker, cache, consumers);
        collectPublishEvents(sourceFile, checker, cache, producers);
    }
    const registry = {
        service: getServiceName(),
        producers: [...producers].sort(),
        consumers: [...consumers].sort(),
    };
    const outPath = join(PROJECT_ROOT, "event_registry.json");
    writeFileSync(outPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
    $log.info({ producers: registry.producers, consumers: registry.consumers });
}
main();
