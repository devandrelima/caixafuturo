import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Padrão de 1 s é curto para fluxos que hasheiam dezenas de vendas (SHA-256 puro) sob cobertura v8 ou CPU disputada
// (falha intermitente observada em salesFlow.test.tsx). Só aumenta o TEMPO MÁXIMO de espera; nenhuma asserção muda.
configure({ asyncUtilTimeout: 15_000 });

afterEach(() => cleanup());
