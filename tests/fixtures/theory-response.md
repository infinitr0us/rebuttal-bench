Thank you for asking where the constant in Proposition 2 comes from. Write $\mathcal{L}(x) = \frac{1}{2} x^T H x$ and let $m \leq M$ be the extreme eigenvalues of $H$. Along an eigenvector with eigenvalue $\lambda$, one step multiplies its coefficient by $1 - \eta \lambda$. For $0 < \eta \leq \frac{1}{M}$ the largest such factor is attained at $m$.

$$\begin{align}
\mathcal{L}(x) - \mathcal{L}(y) & = \frac{1}{2}(x-y)^T H (x+y)
\end{align}$$

The two-dimensional example in the appendix uses distinct eigenvalues $m \neq M$. In the eigenbasis the update reads

$$
\begin{aligned}
u & = (1 - \eta m) a \\\\
v & = (1 - \eta M) b
\end{aligned}
$$

Equivalently, the new coefficient vector is $\begin{pmatrix}u\\\\v\end{pmatrix}$ and the update matrix is $\begin{pmatrix}1 - \eta m & 0 \\\\ 0 & 1 - \eta M\end{pmatrix}$. This proves the claimed contraction, including the boundary case $\eta = \frac{1}{M}$. We will distinguish this deterministic step from the noisy estimate $\hat{x}$ in the revised proof.
