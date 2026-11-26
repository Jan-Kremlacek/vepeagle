# Third-party code shipped with this suite

## p5.js 1.9.3

`p5.min.js` in this folder is the unmodified minified build from the npm
package `p5@1.9.3`, byte-identical to
`https://cdn.jsdelivr.net/npm/p5@1.9.3/lib/p5.min.js`:

    sha256  2fee13caa878c2350ae3923af75be5148dad7fc066ce53e837fd26a25dcb553c
    sha384  f0yxPojt7RcD8oiNbarUEFxtiJSO0JsM8feWy2U/tviNhVNEoWaihiZHqJrRlkb2   (Subresource Integrity form)
    size    1033747 bytes

It is bundled rather than fetched so that the suite runs on a machine with no
network, which is where a stimulus display usually sits, and so that what is
presented does not depend on a third party remaining reachable and unchanged.

p5.js is distributed under the **GNU Lesser General Public License v2.1**; the
full text is in `p5.js-LICENSE.txt`. That license applies to `p5.min.js` only.
The suite's own files are MIT (author Jan Kremláček). p5.js is used as an
unmodified library loaded by `<script src="p5.min.js">`; it is not altered and
not statically combined, so replacing it with another build of the same
version requires nothing more than overwriting the file.

Home page and source: https://p5js.org/ — https://github.com/processing/p5.js
