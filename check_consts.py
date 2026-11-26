"""Report SCREAMING_CASE identifiers that a script uses but never declares.

node --check cannot find these: an undeclared identifier is valid syntax and
only fails when the line runs, which for log-building code means at the end of a
session — after the recording, and looking like a hang rather than an error.
"""
import re
import sys

GLOBALS = set("""
Math JSON Object Array String Number Boolean Date RegExp Map Set Promise NaN Infinity
undefined document window navigator screen performance console location URL
URLSearchParams Blob FileReader Event setTimeout setInterval clearTimeout
clearInterval requestAnimationFrame cancelAnimationFrame parseFloat parseInt
isFinite isNaN encodeURIComponent decodeURIComponent escape unescape btoa atob
alert confirm localStorage sessionStorage VEP
TWO_PI PI HALF_PI QUARTER_PI RGB HSB
""".split())

NAME = re.compile(r'\b([A-Z][A-Z0-9_]{2,})\b')
# One declaration can introduce several names: const A = 1, B = 2;
DECL_STMT = re.compile(r'\b(?:const|let|var)\s+([^;{}\n]+)')


def strip_comments(code):
    code = re.sub(r'/\*[\s\S]*?\*/', ' ', code)
    return re.sub(r'//[^\n]*', ' ', code)


def strip_noise(code):
    """Remove comments, string bodies and member accesses (gl.RGBA and friends)."""
    code = re.sub(r'/\*[\s\S]*?\*/', ' ', code)
    code = re.sub(r'//[^\n]*', ' ', code)
    # All three quote styles in one left-to-right pass. Doing them in separate
    # passes desynchronises on an apostrophe inside a double-quoted string —
    # "the panel's" would open a bogus single-quoted string and swallow the code
    # after it, which is how this check first came back clean on a broken file.
    code = re.sub(r'"(?:\\.|[^"\\])*"'
                  r"|'(?:\\.|[^'\\])*'"
                  r'|`(?:\\.|[^`\\])*`', '""', code)
    code = re.sub(r'\.\s*[A-Za-z_$][A-Za-z0-9_$]*', ' ', code)
    return code


def block_range(code, pos):
    """Character range of the { } block enclosing pos, or None at top level."""
    depth, start = 0, None
    for i, ch in enumerate(code[:pos]):
        if ch == '{':
            depth += 1
            if depth == 1:
                start = i
        elif ch == '}':
            depth -= 1
    if depth <= 0:
        return None
    depth, i = 1, start + 1
    while i < len(code) and depth:
        if code[i] == '{':
            depth += 1
        elif code[i] == '}':
            depth -= 1
        i += 1
    return (start, i)


def out_of_scope(code):
    """Names declared inside a block but referenced outside it.

    Syntactically valid, caught by nothing else, and fatal at run time: the
    reference throws only when its line executes. GET_MAP was declared inside a
    DOMContentLoaded handler and read by the autostart screen, which left a page
    that rendered nothing at all.
    """
    ranges = {}
    for m in re.finditer(r'\b(?:const|let|var)\s+([A-Z][A-Z0-9_]{2,})\b', code):
        name = m.group(1)
        if name in GLOBALS:
            continue          # a local of the same name merely shadows the global
        rng = block_range(code, m.start())
        if rng is None:
            ranges[name] = None   # one module-scope declaration covers everything
        elif ranges.get(name, 'x') is not None:
            ranges.setdefault(name, []).append(rng)
    bad = []
    for name, rngs in ranges.items():
        if rngs is None:
            continue
        # The same name may be declared separately in several sibling functions;
        # a use is only wrong when it falls outside every one of them.
        for u in re.finditer(r'\b%s\b' % name, code):
            if not any(a <= u.start() < b for a, b in rngs):
                bad.append(name)
                break
    return sorted(set(bad))


def check(path):
    src = open(path, encoding='utf-8').read()
    blocks = re.findall(r'<script>(.*?)</script>', src, re.S) if path.endswith('.html') else [src]
    missing = set()
    for block in blocks:
        code = strip_noise(block)
        # Declarations are read from the comment-stripped source rather than the
        # fully stripped one. String stripping cannot handle nested template
        # literals, and when it loses sync it swallows real declarations — which
        # turns this check into a source of false alarms, and a check nobody
        # trusts is worse than no check. Usages still come from the stripped
        # code, so quoted words are not mistaken for identifiers.
        declared = set()
        for stmt in DECL_STMT.findall(strip_comments(block)):
            declared.update(NAME.findall(stmt))
        for name in set(NAME.findall(code)) - declared - GLOBALS:
            missing.add(name)
        # Two independent readings must agree before this is reported. Brace
        # depth is computed on text with strings removed, and that removal
        # cannot handle nested template literals; when it loses sync every
        # declaration after the bad spot looks nested. Requiring the
        # comments-only reading to agree removes those false alarms, at the
        # cost of missing a case where a brace hides inside a string — which is
        # the safer way round for a check meant to be trusted.
        loose = set(out_of_scope(strip_comments(block)))
        for name in out_of_scope(code):
            if name in loose:
                missing.add(name + ' (declared inside a block, used outside)')
    return sorted(missing)


if __name__ == '__main__':
    bad = False
    for path in sys.argv[1:]:
        found = check(path)
        if found:
            bad = True
        print('%-28s %s' % (path, ', '.join(found) if found else 'all names declared'))
    sys.exit(1 if bad else 0)
