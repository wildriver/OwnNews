# OwnNews: A Personalized, Health-Aware News Curator

OwnNews is a next-generation news curation platform designed to promote "Information Health" by visualizing and balancing the user's information diet. It leverages state-of-the-art Large Language Models (LLMs) and Vector Search technologies to provide a personalized yet balanced news consumption experience.

## 1. System Architecture

The system is built on a modern, serverless architecture combining edge computing and vector databases.

### 1.1 Overview
- **Frontend**: Next.js 15 (App Router) deployed on Cloudflare Pages.
- **Backend / AI**: Cloudflare Workers executing AI models (Llama 3, BGE-M3).
- **Database**: Supabase (PostgreSQL + pgvector) for relational data and vector similarity search.
- **Data Collection**: Python scripts (GitHub Actions) fetching RSS feeds from [CEEK.JP NEWS](https://news.ceek.jp/).

### 1.2 Data Pipeline
1.  **Ingestion**: The collector script fetches news articles via RSS.
2.  **Vectorization**: Content is embedded into 1024-dimensional vectors using **BAAI/bge-m3** (multilingual) on Cloudflare Workers.
3.  **Analysis**: **Meta/Llama-3-8b-Instruct** analyzes the content to:
    - Determine "Nutrient Scores" (Fact, Context, Perspective, Emotion, Immediacy).
    - Assign precise categories.
4.  **Storage**: Metadata and vectors are stored in Supabase.

## 2. Algorithmic Details

### 2.1 Information Nutrient Scoring
To quantify the "nutritional value" of information, we employ a 5-axis scoring system calculated by Llama 3:
- **Fact (Protein)**: Objectivity, data presence, and 5W1H clarity.
- **Context (Carbohydrate)**: Background information and historical context.
- **Perspective (Vitamins/Minerals)**: Diversity of viewpoints and pros/cons analysis.
- **Emotion (Fat)**: Emotional appeal and dramatic elements.
- **Immediacy (Water)**: Freshness and urgency of the news.

### 2.2 Personalization Engine (Filter Strength)
The "Filter Strength" slider ($S \in [0, 1]$) controls the mixing ratio between minimizing semantic distance and maximizing serendipity.
The feed generation algorithm selects $N$ articles based on the following ratio:
- **Personalized Set** ($N \times S$): Retrieved via cosine similarity search between the User Vector and Article Vectors.
- **Discovery Set** ($N \times (1-S)$): Retrieved based on chronological order (latest news) to ensure exposure to breaking topics.
The two sets are interleaved to create a seamless feed.

### 2.3 Topic Clustering (Grouping Threshold)
To present diverse perspectives on the same topic, we implement a Greedy Clustering algorithm based on semantic similarity.
- **Metric**: Cosine Similarity.
- **Threshold** ($T$): User-adjustable parameter (default $0.92$).
- **Logic**: For a given sorted list of articles, an article $d_j$ is grouped with a leading article $d_i$ if $Similarity(d_i, d_j) \ge T$.

## 3. Technology Stack

| Component | Technology | Description |
|-----------|------------|-------------|
| **Frontend Framework** | **Next.js 15** | App Router, Server Components, Edge Runtime |
| **Styling** | **Tailwind CSS** | Utility-first CSS, Glassmorphism UI |
| **Edge Computing** | **Cloudflare Workers** | Global low-latency execution |
| **LLM Inference** | **Workers AI** | Llama-3-8b-Instruct, BAAI/bge-m3 |
| **Database** | **Supabase** | PostgreSQL 15, pgvector extension |
| **Auth** | **Supabase Auth** | Google OAuth integration |

## 4. Acknowledgments

本研究は，科学研究費補助金（**JP23H00216**）ならびに JSTERATO（**JPMJER2502**）の支援のもと実施されている．
また、ニュースソースとして **[CEEK.JP NEWS](https://news.ceek.jp/)** 様のRSSフィードを利用させていただいております。ここに記して感謝申し上げます。

## 5. Disclaimer

This project is a research prototype. Please verify the accuracy of the AI-generated analysis.
Users should comply with the terms of service of the respective news sources.
