import type {Component} from 'svelte';

export type MenuItem={id:string;label:string;icon?:Component<any>;danger?:boolean;disabled?:boolean;hint?:string};
export type MenuEntry=MenuItem|'separator';
