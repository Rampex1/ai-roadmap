# Exercise harness, shared by the browser worker and scripts/check-exercises.mjs.
# run(code, tests) executes the learner's code, then the hidden asserts, in one fresh namespace,
# collects matplotlib figures (after the tests, so tests can inspect them) and returns JSON:
# {"status": "passed" | "failed" | "error", "message": str, "figures": [base64 PNG, ...]}
import json
import linecache
import sys
import traceback

CODE = "<your code>"
TESTS = "<tests>"
MAX_FIGURES = 10

# Learner code shares one interpreter across runs and exercises. Snapshot what it could tamper
# with (stdio, builtins, our JSON encoder) so every run starts clean and grading can't be spoofed.
import builtins as _builtins

_dumps = json.dumps
_BUILTINS = dict(_builtins.__dict__)
_STDIO = (sys.stdin, sys.stdout, sys.stderr)


def _restore():
    sys.stdin, sys.stdout, sys.stderr = _STDIO
    _builtins.__dict__.clear()
    _builtins.__dict__.update(_BUILTINS)


def _source(name, text):
    # Lets tracebacks show the learner's lines.
    linecache.cache[name] = (len(text), None, text.splitlines(True), name)


def _error(e):
    if isinstance(e, SyntaxError):
        return "".join(traceback.format_exception_only(e)).rstrip()
    frames = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == CODE]
    head = "Traceback (most recent call last):\n" + "".join(traceback.format_list(frames)) if frames else ""
    return head + "".join(traceback.format_exception_only(e)).rstrip()


def _failure(e, tests):
    lines = tests.splitlines()
    tb = [f for f in traceback.extract_tb(e.__traceback__) if f.filename == TESTS]
    where = lines[tb[-1].lineno - 1].strip() if tb and 0 < tb[-1].lineno <= len(lines) else ""
    try:  # show the check itself, not its message source: "assert f(x) == 5"
        import ast

        node = ast.parse(where).body[0]
        if isinstance(node, ast.Assert):
            where = "assert " + ast.unparse(node.test)
    except Exception:
        pass
    msg = f"Test failed: {where}" if where else "Test failed."
    detail = str(e)
    return msg + (f"\nAssertionError: {detail}" if detail else "\nAssertionError")


def _figures():
    plt = sys.modules.get("matplotlib.pyplot")
    if plt is None:
        return []
    import base64
    import io
    import warnings

    out = []
    try:
        for num in plt.get_fignums()[:MAX_FIGURES]:
            buf = io.BytesIO()
            with warnings.catch_warnings():  # Pyodide's Agg build warns about float pixel sizes
                warnings.simplefilter("ignore")
                plt.figure(num).savefig(buf, format="png", dpi=110, bbox_inches="tight")
            out.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    finally:
        plt.close("all")
    return out


def preimport(source):
    """Import the modules the code names (e.g. sklearn.linear_model) before the time limit starts,
    so a cold library import never counts against the learner. Errors surface later, in run()."""
    import ast
    import importlib

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
            names.add(node.module)
    for name in sorted(names):
        try:
            importlib.import_module(name)
        except BaseException:
            pass


def run(code, tests):
    _source(CODE, code)
    _source(TESTS, tests)
    ns = {"__name__": "__main__"}
    try:
        status, message = _execute(code, tests, ns)
    finally:
        _restore()
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        figures = _figures()
    except Exception as e:
        figures = []
        if status == "passed":
            status, message = "error", "Could not draw the figure: " + _error(e)
    return _dumps({"status": status, "message": message, "figures": figures})


def _execute(code, tests, ns):
    try:
        exec(compile(code, CODE, "exec"), ns)
    except BaseException as e:
        return "error", _error(e)
    try:
        exec(compile(tests, TESTS, "exec"), ns)
    except AssertionError as e:
        return "failed", _failure(e, tests)
    except BaseException as e:
        return "error", _error(e)
    return "passed", "All tests passed."
