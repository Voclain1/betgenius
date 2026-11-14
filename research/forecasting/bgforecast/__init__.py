"""BetGenius forecasting research engine.

A research-only package: it reads a dataset written by the read-only extractor
(research/forecasting/extract) and never touches a database, the network, or
any production code path.
"""

__version__ = "1.0.0"
SUPPORTED_SCHEMA = "bg-research-dataset/1"
