import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Órbita • Operação de campanhas',description:'Campanhas, aprovações e resultados da sua agência.'};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="pt-BR"><body>{children}</body></html>;}
