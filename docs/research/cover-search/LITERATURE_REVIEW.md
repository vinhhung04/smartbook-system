# Literature Review — Book-Cover Retrieval with CLIP and Vision-Language OCR

Status: **COMPLETED** for the scope below (2026-11-12). Every reference was checked against a primary record: DOIs resolved through the Crossref API (title, authors, venue, year, pages compared), arXiv preprints through the arXiv API, ICML/ICLR papers through PMLR / ML Anthology. Peer-review status is stated per entry. No reference was taken from memory without such a check.

## 1. Themes

### 1.1 Mobile visual search and book-cover recognition
Book covers were a standard object class in early mobile visual search. Girod et al. [R3] survey the pipeline (local features, compressed descriptors, geometric verification); the Stanford Mobile Visual Search data set [R4] includes CD/DVD/book covers photographed with phones against clean reference images — the same *query photo vs. catalog reference* setting studied here. These systems relied on local invariant features (SIFT [R6]) and vocabulary-tree indexing [R5]. Deep global descriptors later replaced hand-crafted ones for instance retrieval [R19]. Book covers have also been studied as a *classification* problem (genre from cover) [R8], [R9] and as a source of text for VQA (OCR-VQA, 207k book covers) [R16] — the latter shows that title/author text on covers is a strong, machine-readable signal.

**Gap:** these works either use local-feature matching or classify genres; none evaluates a frozen contrastive image encoder combined with an LLM-based reader for *catalog look-up*, nor Vietnamese covers.

### 1.2 Contrastive image–text models
CLIP [R1] learns a joint embedding from 400M image–text pairs and transfers zero-shot to many recognition tasks; its ViT image encoders follow Dosovitskiy et al. [R2]. OpenCLIP scaling studies [R15] report retrieval performance as a function of model/data scale. SmartBook uses the smallest public CLIP (ViT-B/32) as a frozen instance-retrieval encoder; CLIP was not trained for instance-level retrieval, and its 224-px center crop removes part of a portrait cover — limitations examined in this study.

### 1.3 OCR and vision-language models as readers
Classical OCR engines (Tesseract [R7]) need text detection and language models per script. OCR-free document transformers (Donut [R10]) and large multimodal models read text end-to-end; OCRBench [R11] shows LMMs are strong on regular Latin text but weaker on non-Latin, handwritten and dense text. The Qwen-VL family [R12], [R13], [R14] targets text reading explicitly. SmartBook uses a hosted Qwen model through OpenRouter with a JSON-only prompt; its OCR accuracy on Vietnamese diacritics and Hán-Nôm is an empirical question here.

### 1.4 Multimodal fusion and rank fusion
Fusion strategies are commonly grouped into early, late and hybrid fusion [R17], [R18]. SmartBook's design is late fusion: two independent rankers (visual cosine; text retrieval) merged per catalog item by a fixed weighted average with gates. Inside the text ranker, semantic and keyword lists are combined with Reciprocal Rank Fusion [R20], and text embeddings come from Qwen3-Embedding [R21].

### 1.5 Open-set retrieval and robustness
A deployed cover search must say "not in catalog". Open-set recognition formalises rejecting unknown classes [R22], [R23]; in SmartBook rejection is implemented by score thresholds (visual 0.80, confidence 0.5). Robustness to common corruptions (blur, noise, JPEG, brightness) is benchmarked by Hendrycks and Dietterich [R24]; Track B adapts that idea (fixed-seed, parameterised perturbations) to cover images.

### 1.6 Statistics for paired, clustered evaluations
Paired binary outcomes (method A vs B right/wrong on the same query) → McNemar's test [R25]. Queries sharing a book are correlated, so CIs use a cluster (book-level) bootstrap [R26].

## 2. What fits SmartBook / what was rejected

| Idea from literature | Used? | Reason |
|---|---|---|
| Local features + geometric verification [R3]–[R6] | No (discussed as related work) | Not in the production code; study evaluates the implemented pipeline only. |
| Fine-tuning CLIP for instance retrieval [R19] | No | Out of scope (no training); listed as future work. |
| Approximate NN index (FAISS) [R27] | No | Gallery size (≈10²) makes the linear scan exact and fast; relevant only at scale. |
| Corruption benchmark protocol [R24] | Yes (adapted) | Track B perturbations with recorded parameters/seeds. |
| Cluster bootstrap + McNemar [R25], [R26] | Yes | Correct uncertainty for clustered paired data. |

## 3. Reference list (IEEE style; status = peer-reviewed / preprint)

| ID | Reference | Status | Verified via |
|---|---|---|---|
| R1 | A. Radford, J. W. Kim, C. Hallacy, et al., "Learning transferable visual models from natural language supervision," in *Proc. 38th Int. Conf. Machine Learning (ICML)*, PMLR vol. 139, 2021, pp. 8748–8763. https://proceedings.mlr.press/v139/radford21a.html | Peer-reviewed | PMLR page |
| R2 | A. Dosovitskiy, L. Beyer, A. Kolesnikov, et al., "An image is worth 16x16 words: Transformers for image recognition at scale," in *Proc. ICLR*, 2021. https://openreview.net/forum?id=YicbFdNTTy | Peer-reviewed | ML Anthology |
| R3 | B. Girod, V. Chandrasekhar, D. M. Chen, N.-M. Cheung, R. Grzeszczuk, Y. Reznik, et al., "Mobile visual search," *IEEE Signal Process. Mag.*, vol. 28, no. 4, pp. 61–76, 2011, doi: 10.1109/MSP.2011.940881. | Peer-reviewed | Crossref |
| R4 | V. R. Chandrasekhar, D. M. Chen, S. S. Tsai, N.-M. Cheung, H. Chen, G. Takacs, et al., "The Stanford mobile visual search data set," in *Proc. 2nd ACM Conf. Multimedia Systems (MMSys)*, 2011, pp. 117–122, doi: 10.1145/1943552.1943568. | Peer-reviewed | Crossref |
| R5 | D. Nistér and H. Stewénius, "Scalable recognition with a vocabulary tree," in *Proc. IEEE CVPR*, vol. 2, 2006, pp. 2161–2168, doi: 10.1109/CVPR.2006.264. | Peer-reviewed | Crossref |
| R6 | D. G. Lowe, "Distinctive image features from scale-invariant keypoints," *Int. J. Comput. Vis.*, vol. 60, no. 2, pp. 91–110, 2004, doi: 10.1023/B:VISI.0000029664.99615.94. | Peer-reviewed | Crossref |
| R7 | R. Smith, "An overview of the Tesseract OCR engine," in *Proc. 9th ICDAR*, 2007, pp. 629–633, doi: 10.1109/ICDAR.2007.4376991. | Peer-reviewed | Crossref |
| R8 | B. K. Iwana, S. T. R. Rizvi, S. Ahmed, A. Dengel, and S. Uchida, "Judging a book by its cover," arXiv:1610.09204, 2016. | Preprint | arXiv API |
| R9 | A. Lucieri, H. Sabir, S. A. Siddiqui, S. T. R. Rizvi, B. K. Iwana, S. Uchida, et al., "Benchmarking deep learning models for classification of book covers," *SN Comput. Sci.*, vol. 1, no. 3, 2020, doi: 10.1007/s42979-020-00132-z. | Peer-reviewed | Crossref |
| R10 | G. Kim, T. Hong, M. Yim, J. Nam, J. Park, J. Yim, et al., "OCR-free document understanding transformer," in *Computer Vision – ECCV 2022*, LNCS, 2022, pp. 498–517, doi: 10.1007/978-3-031-19815-1_29. | Peer-reviewed | Crossref |
| R11 | Y. Liu, Z. Li, M. Huang, B. Yang, W. Yu, C. Li, et al., "OCRBench: On the hidden mystery of OCR in large multimodal models," *Sci. China Inf. Sci.*, vol. 67, no. 12, 2024, doi: 10.1007/s11432-024-4235-6. | Peer-reviewed | Crossref |
| R12 | J. Bai, S. Bai, S. Yang, S. Wang, et al., "Qwen-VL: A versatile vision-language model for understanding, localization, text reading, and beyond," arXiv:2308.12966, 2023. | Preprint | arXiv API |
| R13 | P. Wang, S. Bai, S. Tan, S. Wang, et al., "Qwen2-VL: Enhancing vision-language model's perception of the world at any resolution," arXiv:2409.12191, 2024. | Preprint | arXiv API |
| R14 | S. Bai, K. Chen, X. Liu, J. Wang, et al., "Qwen2.5-VL technical report," arXiv:2502.13923, 2025. | Preprint | arXiv API |
| R15 | M. Cherti, R. Beaumont, R. Wightman, M. Wortsman, G. Ilharco, C. Gordon, et al., "Reproducible scaling laws for contrastive language-image learning," in *Proc. IEEE/CVF CVPR*, 2023, pp. 2818–2829, doi: 10.1109/CVPR52729.2023.00276. | Peer-reviewed | Crossref |
| R16 | A. Mishra, S. Shekhar, A. K. Singh, and A. Chakraborty, "OCR-VQA: Visual question answering by reading text in images," in *Proc. ICDAR*, 2019, pp. 947–952, doi: 10.1109/ICDAR.2019.00156. | Peer-reviewed | Crossref |
| R17 | T. Baltrušaitis, C. Ahuja, and L.-P. Morency, "Multimodal machine learning: A survey and taxonomy," *IEEE Trans. Pattern Anal. Mach. Intell.*, vol. 41, no. 2, pp. 423–443, 2019, doi: 10.1109/TPAMI.2018.2798607. | Peer-reviewed | Crossref |
| R18 | P. K. Atrey, M. A. Hossain, A. El Saddik, and M. S. Kankanhalli, "Multimodal fusion for multimedia analysis: A survey," *Multimedia Syst.*, vol. 16, no. 6, pp. 345–379, 2010, doi: 10.1007/s00530-010-0182-0. | Peer-reviewed | Crossref |
| R19 | A. Gordo, J. Almazán, J. Revaud, and D. Larlus, "Deep image retrieval: Learning global representations for image search," in *Computer Vision – ECCV 2016*, LNCS, 2016, pp. 241–257, doi: 10.1007/978-3-319-46466-4_15. | Peer-reviewed | Crossref |
| R20 | G. V. Cormack, C. L. A. Clarke, and S. Buettcher, "Reciprocal rank fusion outperforms Condorcet and individual rank learning methods," in *Proc. 32nd ACM SIGIR*, 2009, pp. 758–759, doi: 10.1145/1571941.1572114. | Peer-reviewed | Crossref |
| R21 | Y. Zhang, M. Li, D. Long, X. Zhang, et al., "Qwen3 Embedding: Advancing text embedding and reranking through foundation models," arXiv:2506.05176, 2025. | Preprint | arXiv API |
| R22 | W. J. Scheirer, A. de Rezende Rocha, A. Sapkota, and T. E. Boult, "Toward open set recognition," *IEEE Trans. Pattern Anal. Mach. Intell.*, vol. 35, no. 7, pp. 1757–1772, 2013, doi: 10.1109/TPAMI.2012.256. | Peer-reviewed | Crossref |
| R23 | C. Geng, S.-J. Huang, and S. Chen, "Recent advances in open set recognition: A survey," *IEEE Trans. Pattern Anal. Mach. Intell.*, vol. 43, no. 10, pp. 3614–3631, 2021, doi: 10.1109/TPAMI.2020.2981604. | Peer-reviewed | Crossref |
| R24 | D. Hendrycks and T. Dietterich, "Benchmarking neural network robustness to common corruptions and perturbations," in *Proc. ICLR*, 2019 (arXiv:1903.12261). | Peer-reviewed | arXiv API + ML Anthology listing |
| R25 | Q. McNemar, "Note on the sampling error of the difference between correlated proportions or percentages," *Psychometrika*, vol. 12, no. 2, pp. 153–157, 1947, doi: 10.1007/BF02295996. | Peer-reviewed | Crossref |
| R26 | C. A. Field and A. H. Welsh, "Bootstrapping clustered data," *J. R. Stat. Soc. Ser. B*, vol. 69, no. 3, pp. 369–390, 2007, doi: 10.1111/j.1467-9868.2007.00593.x. | Peer-reviewed | Crossref |
| R27 | J. Johnson, M. Douze, and H. Jégou, "Billion-scale similarity search with GPUs," *IEEE Trans. Big Data*, vol. 7, no. 3, pp. 535–547, 2021, doi: 10.1109/TBDATA.2019.2921572. | Peer-reviewed | Crossref |

Retrieval date for all checks: 2026-11-12.
