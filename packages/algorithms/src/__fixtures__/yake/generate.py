"""
Generates reference.json: keyphrases from the reference YAKE implementation for the sample
texts below, so the TypeScript port can be checked against it (CLAUDE.md §11.2).

Run once, in a throwaway virtual environment (the reference package is LGPL-3.0 and is
never a dependency of this project; only its outputs are committed):

    python -m venv .venv && .venv/Scripts/python -m pip install yake==0.4.8
    .venv/Scripts/python generate.py <path to stopwords-iso.json>

The stopword list is the English list of stopwords-iso (MIT), the same dataset the app syncs.
"""

import json
import sys
from pathlib import Path

import yake

HERE = Path(__file__).parent

TEXTS = [
    {
        "id": "fyp-idea",
        "text": (
            "Smart Attendance System Using Face Recognition\n"
            "Universities still take attendance by calling names, which wastes the first minutes of every lecture. "
            "This project builds a smart attendance system that recognizes students from a classroom camera. "
            "Face recognition runs on a small edge device, so video never leaves the classroom. "
            "Teachers see attendance in a web dashboard and can correct mistakes. "
            "The system stores face embeddings, not photos, and deletes them when a student graduates. "
            "We will compare face recognition accuracy under different lighting conditions."
        ),
    },
    {
        "id": "readme",
        "text": (
            "Campus Map is an open source web application that helps new students find buildings, lecture halls "
            "and cafeterias on a university campus. The campus map works offline and supports indoor navigation.\n"
            "Features\n"
            "Search for any building by name or department. Indoor navigation shows the shortest route between lecture halls. "
            "Accessible routes avoid stairs for wheelchair users. Offline maps are cached in the browser.\n"
            "Contributing\n"
            "Pull requests are welcome. Please open an issue first to discuss what you would like to change."
        ),
    },
    {
        "id": "abstract",
        "text": (
            "Group projects are common in computer science education, yet contribution is often uneven. "
            "We study version control histories from student teams to measure how work is shared. "
            "Commit counts alone are misleading, because generated files and vendored libraries inflate line counts. "
            "We propose a contribution report that excludes generated files, credits co-authors, and summarises the "
            "distribution of work with the Gini coefficient. In a study of forty student teams, the contribution report "
            "helped teaching assistants start conversations about uneven contribution earlier in the semester."
        ),
    },
]

OPTIONS = {"ngramMax": 3, "top": 10, "dedupThreshold": 0.8}


def main() -> None:
    stopwords = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["en"]
    extractor = yake.KeywordExtractor(
        lan="en", n=OPTIONS["ngramMax"], dedupLim=OPTIONS["dedupThreshold"], dedupFunc="levs", top=OPTIONS["top"], stopwords=stopwords
    )
    cases = [
        {"id": case["id"], "text": case["text"], "reference": [{"keyphrase": kw, "score": score} for kw, score in extractor.extract_keywords(case["text"])]}
        for case in TEXTS
    ]
    output = {"generatedWith": "yake 0.4.8, dedupFunc levs", "options": OPTIONS, "cases": cases}
    (HERE / "reference.json").write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (HERE.parent / "stopwords").mkdir(exist_ok=True)
    (HERE.parent / "stopwords" / "en.json").write_text(json.dumps(sorted(set(stopwords)), indent=0, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
