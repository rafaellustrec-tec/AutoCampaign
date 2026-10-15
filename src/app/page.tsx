import { currentUser } from '@/lib/auth';
import Dashboard from '@/components/dashboard';
export const dynamic='force-dynamic';
export default async function Page(){const user=await currentUser();return <Dashboard user={user}/>;}
